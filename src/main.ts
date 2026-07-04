import { MarkdownRenderer, MarkdownView, Notice, Plugin, TAbstractFile, TFile, editorInfoField } from 'obsidian';
import { Extension, RangeSetBuilder, StateEffect } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, PluginValue, ViewPlugin, ViewUpdate } from '@codemirror/view';

interface TextAnchor {
	/** Current linked text. This is updated as the user edits the linked range. */
	text: string;
	/** Character offsets are retained as a fast path for locating the source text. */
	start: number;
	end: number;
	/** Zero-based occurrence of the selected string before `start`. */
	occurrence: number;
	/** Context is used to recover a link after edits made while the note is closed. */
	contextBefore?: string;
	contextAfter?: string;
}

interface FloatingTextBox {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	markdown: string;
	color: string;
	opacity: number;
	/** Whether the label is currently visible over the note. Ctrl/Cmd+click on linked text toggles this. */
	visible: boolean;
	updatedAt: string;
	anchor?: TextAnchor;
}


interface FloatingTextStore {
	version: 6;
	notes: Record<string, FloatingTextBox[]>;
}

/**
 * Floating labels are stored in document-space coordinates. The overlay is translated
 * by the Markdown scroller offset so every label stays attached to its note position.
 */
interface ScrollMetrics {
	left: number;
	top: number;
	viewportWidth: number;
	viewportHeight: number;
	contentWidth: number;
	contentHeight: number;
	originX: number;
	originY: number;
}

interface LayerScrollBinding {
	view: MarkdownView;
	primaryScroller: HTMLElement;
	abort: AbortController;
	resizeObserver: ResizeObserver;
	animationFrame: number | undefined;
}

interface LinkedTextMarker {
	start: number;
	end: number;
	boxIds: string[];
	labelText: string;
}

const DEFAULT_WIDTH = 280;
const DEFAULT_HEIGHT = 190;
const MIN_WIDTH = 160;
const MIN_HEIGHT = 96;
const DEFAULT_COLOR = '#FFFFFF';
const DEFAULT_OPACITY = 0.96;
const EMPTY_PLACEHOLDER = 'Type here…';
const ANCHOR_CONTEXT_LENGTH = 80;

interface EditorPosition {
	line: number;
	ch: number;
}

interface TextareaHistoryState {
	value: string;
	start: number;
	end: number;
}

interface ObsidianCommandLike {
	editorCallback?: (editor: FloatingTextareaEditorBridge) => unknown;
	callback?: () => unknown;
}

interface ObsidianCommandsLike {
	executeCommandById: (commandId: string) => boolean;
	commands?: Record<string, ObsidianCommandLike>;
}

interface EditingToolbarPluginLike {
	settings?: Record<string, unknown>;
}

interface PluginRegistryLike {
	getPlugin?: (id: string) => EditingToolbarPluginLike | undefined;
	plugins?: Record<string, EditingToolbarPluginLike | undefined>;
}

/**
 * A narrow Editor-compatible adapter around a floating textarea. Editing Toolbar 4.x
 * resolves commands from workspace.activeEditor, so when a label is focused we return
 * this adapter instead of the Markdown editor. It intentionally implements the common
 * Obsidian Editor surface used by Formatting Toolbar and core formatting commands.
 */
class FloatingTextareaEditorBridge {
	private history: TextareaHistoryState[] = [];
	private historyIndex = -1;
	private suppressHistory = false;

	constructor(readonly textarea: HTMLTextAreaElement) {
		this.recordHistory();
		this.textarea.addEventListener('input', this.onNativeInput);
	}

	dispose(): void {
		this.textarea.removeEventListener('input', this.onNativeInput);
	}

	getValue(): string {
		return this.textarea.value;
	}

	setValue(value: string): void {
		this.applyValue(value, value.length, value.length);
	}

	getSelection(): string {
		return this.textarea.value.slice(this.textarea.selectionStart, this.textarea.selectionEnd);
	}

	somethingSelected(): boolean {
		return this.textarea.selectionStart !== this.textarea.selectionEnd;
	}

	getCursor(which: 'from' | 'to' | 'head' | 'anchor' = 'head'): EditorPosition {
		const offset = which === 'from' || which === 'anchor'
			? this.textarea.selectionStart
			: this.textarea.selectionEnd;
		return this.offsetToPos(offset);
	}

	setCursor(positionOrLine: EditorPosition | number, ch?: number): void {
		const position = typeof positionOrLine === 'number'
			? { line: positionOrLine, ch: ch ?? 0 }
			: positionOrLine;
		const offset = this.posToOffset(position);
		this.textarea.setSelectionRange(offset, offset);
	}

	setSelection(from: EditorPosition, to: EditorPosition = from): void {
		this.textarea.setSelectionRange(this.posToOffset(from), this.posToOffset(to));
	}

	setSelections(selections: Array<{ anchor: EditorPosition; head: EditorPosition }>): void {
		const first = selections[0];
		if (first) {
			this.setSelection(first.anchor, first.head);
		}
	}

	listSelections(): Array<{ anchor: EditorPosition; head: EditorPosition }> {
		return [{
			anchor: this.offsetToPos(this.textarea.selectionStart),
			head: this.offsetToPos(this.textarea.selectionEnd)
		}];
	}

	getRange(from: EditorPosition, to: EditorPosition): string {
		return this.textarea.value.slice(this.posToOffset(from), this.posToOffset(to));
	}

	replaceSelection(replacement: string): void {
		const start = this.textarea.selectionStart;
		const end = this.textarea.selectionEnd;
		this.replaceOffsets(start, end, replacement, start + replacement.length, start + replacement.length);
	}

	replaceRange(replacement: string, from: EditorPosition, to?: EditorPosition): void {
		const start = this.posToOffset(from);
		const end = to ? this.posToOffset(to) : start;
		this.replaceOffsets(start, end, replacement, start + replacement.length, start + replacement.length);
	}

	transaction(spec: { changes?: Array<{ from: EditorPosition; to?: EditorPosition; text: string }> | { from: EditorPosition; to?: EditorPosition; text: string } }): void {
		const rawChanges = spec?.changes;
		const changes = Array.isArray(rawChanges) ? rawChanges : rawChanges ? [rawChanges] : [];
		if (changes.length === 0) {
			return;
		}
		const normalized = changes
			.map((change) => ({
				from: this.posToOffset(change.from),
				to: this.posToOffset(change.to ?? change.from),
				text: change.text ?? ''
			}))
			.sort((left, right) => right.from - left.from);
		let value = this.textarea.value;
		for (const change of normalized) {
			value = `${value.slice(0, change.from)}${change.text}${value.slice(change.to)}`;
		}
		const first = normalized[normalized.length - 1];
		const cursor = first ? first.from + first.text.length : this.textarea.selectionEnd;
		this.applyValue(value, cursor, cursor);
	}

	posToOffset(position: EditorPosition): number {
		const lines = this.textarea.value.split('\n');
		const line = Math.max(0, Math.min(position.line, Math.max(0, lines.length - 1)));
		let offset = 0;
		for (let index = 0; index < line; index += 1) {
			offset += (lines[index]?.length ?? 0) + 1;
		}
		return offset + Math.max(0, Math.min(position.ch, lines[line]?.length ?? 0));
	}

	offsetToPos(offset: number): EditorPosition {
		const clamped = Math.max(0, Math.min(offset, this.textarea.value.length));
		const before = this.textarea.value.slice(0, clamped);
		const line = before.split('\n').length - 1;
		const lastBreak = before.lastIndexOf('\n');
		return { line, ch: clamped - lastBreak - 1 };
	}

	getLine(line: number): string {
		return this.textarea.value.split('\n')[line] ?? '';
	}

	setLine(line: number, text: string): void {
		const start = this.posToOffset({ line, ch: 0 });
		const end = start + this.getLine(line).length;
		this.replaceOffsets(start, end, text, start + text.length, start + text.length);
	}

	lineCount(): number {
		return this.textarea.value.split('\n').length;
	}

	lastLine(): number {
		return Math.max(0, this.lineCount() - 1);
	}

	focus(): void {
		this.textarea.focus({ preventScroll: true });
	}

	scrollIntoView(): void {
		this.textarea.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}

	getScrollInfo(): { left: number; top: number; height: number; width: number; clientHeight: number; clientWidth: number } {
		return {
			left: this.textarea.scrollLeft,
			top: this.textarea.scrollTop,
			height: this.textarea.scrollHeight,
			width: this.textarea.scrollWidth,
			clientHeight: this.textarea.clientHeight,
			clientWidth: this.textarea.clientWidth
		};
	}

	scrollTo(left: number, top: number): void {
		this.textarea.scrollLeft = left;
		this.textarea.scrollTop = top;
	}

	getWrapperElement(): HTMLElement {
		return this.textarea;
	}

	refresh(): void {
		// Native textareas repaint themselves; this method exists for Editor API compatibility.
	}

	undo(): void {
		if (this.historyIndex <= 0) {
			return;
		}
		this.historyIndex -= 1;
		this.restoreHistory(this.history[this.historyIndex]);
	}

	redo(): void {
		if (this.historyIndex >= this.history.length - 1) {
			return;
		}
		this.historyIndex += 1;
		this.restoreHistory(this.history[this.historyIndex]);
	}

	private replaceOffsets(start: number, end: number, replacement: string, selectionStart: number, selectionEnd: number): void {
		const value = `${this.textarea.value.slice(0, start)}${replacement}${this.textarea.value.slice(end)}`;
		this.applyValue(value, selectionStart, selectionEnd);
	}

	private applyValue(value: string, selectionStart: number, selectionEnd: number): void {
		this.suppressHistory = true;
		this.textarea.value = value;
		this.textarea.setSelectionRange(selectionStart, selectionEnd);
		this.textarea.dispatchEvent(new Event('input', { bubbles: true }));
		this.suppressHistory = false;
		this.recordHistory();
	}

	private restoreHistory(state: TextareaHistoryState | undefined): void {
		if (!state) {
			return;
		}
		this.suppressHistory = true;
		this.textarea.value = state.value;
		this.textarea.setSelectionRange(state.start, state.end);
		this.textarea.dispatchEvent(new Event('input', { bubbles: true }));
		this.suppressHistory = false;
	}

	private onNativeInput = (): void => {
		if (!this.suppressHistory) {
			this.recordHistory();
		}
	};

	private recordHistory(): void {
		const state: TextareaHistoryState = {
			value: this.textarea.value,
			start: this.textarea.selectionStart,
			end: this.textarea.selectionEnd
		};
		const previous = this.history[this.historyIndex];
		if (previous && previous.value === state.value && previous.start === state.start && previous.end === state.end) {
			return;
		}
		this.history.splice(this.historyIndex + 1);
		this.history.push(state);
		if (this.history.length > 100) {
			this.history.shift();
		}
		this.historyIndex = this.history.length - 1;
	}
}


/**
 * Floating Text Overlay
 *
 * Text boxes are stored in plugin data, keyed by note path. They are rendered as
 * an overlay, so moving or resizing a label never changes the Markdown body.
 */
export default class FloatingTextOverlayPlugin extends Plugin {
	private store: FloatingTextStore = { version: 6, notes: {} };
	/** New labels remain in memory until the user actually edits, moves, resizes, styles, or explicitly links them. */
	private readonly draftBoxes: Record<string, FloatingTextBox[]> = {};
	private saveTimer: number | undefined;
	private saveQueue: Promise<void> = Promise.resolve();
	/** A lightweight StateEffect refreshes decorations without reconfiguring every editor. */
	private readonly refreshLinkedTextEffect = StateEffect.define<void>();
	private readonly linkedEditorViews = new Set<EditorView>();
	private activeFloatingEditor: FloatingTextareaEditorBridge | undefined;
	private bridgeReleaseTimer: number | undefined;
	private workspaceActiveEditorOwnDescriptor: PropertyDescriptor | undefined;
	private hadWorkspaceActiveEditorOwnProperty = false;
	private nativeActiveEditorGetter: (() => unknown) | undefined;
	private workspaceEditorBridgeActive = false;
	private nativeExecuteCommandById: ((commandId: string) => boolean) | undefined;
	private commandBridgeInstalled = false;
	/** Direct-callback bridge for Editing Toolbar colour controls. */
	private readonly nativeEditingToolbarColorCallbacks = new Map<string, (() => unknown) | undefined>();
	private contextPopover: HTMLElement | undefined;
	private contextPopoverAbort: AbortController | undefined;
	/** Scroll listeners are held per overlay layer and cleaned up when that layer is removed. */
	private readonly layerScrollBindings = new WeakMap<HTMLElement, LayerScrollBinding>();

	async onload(): Promise<void> {
		await this.loadStore();

		this.registerEditorExtension(this.createLinkedTextExtension());
		this.installEditingToolbarBridge();

		this.addRibbonIcon('message-square-plus', 'Add floating text box', () => {
			this.addTextBoxToActiveNote();
		});

		this.addCommand({
			id: 'add-floating-text-box',
			name: 'Add floating text box',
			callback: () => this.addTextBoxToActiveNote()
		});

		this.addCommand({
			id: 'remove-all-floating-text-boxes-in-current-note',
			name: 'Remove all floating text boxes in current note',
			callback: () => this.removeAllBoxesFromActiveNote()
		});


		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.deactivateFloatingEditorBridge();
				window.setTimeout(() => this.renderAllMarkdownViews(), 0);
			})
		);

		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				window.setTimeout(() => this.renderAllMarkdownViews(), 0);
			})
		);

		this.registerEvent(
			this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
				if (!(file instanceof TFile)) {
					return;
				}
				if (this.store.notes[oldPath]) {
					this.store.notes[file.path] = this.store.notes[oldPath];
					delete this.store.notes[oldPath];
					this.scheduleSave();
				}
				if (this.draftBoxes[oldPath]) {
					this.draftBoxes[file.path] = this.draftBoxes[oldPath];
					delete this.draftBoxes[oldPath];
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('delete', (file: TAbstractFile) => {
				if (!(file instanceof TFile)) {
					return;
				}
				const hadPersistedBoxes = Boolean(this.store.notes[file.path]);
				delete this.store.notes[file.path];
				delete this.draftBoxes[file.path];
				if (hadPersistedBoxes) {
					this.scheduleSave();
				}
			})
		);

		this.app.workspace.onLayoutReady(() => this.renderAllMarkdownViews());
	}

	onunload(): void {
		if (this.saveTimer !== undefined) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = undefined;
		}
		this.closeContextPopover();
		this.deactivateFloatingEditorBridge();
		this.restoreEditingToolbarBridge();
		void this.persistStore();
		this.removeAllRenderedLayers();
	}


	/**
	 * Editing Toolbar runs most buttons through app.commands.executeCommandById().
	 * The normal Obsidian command dispatcher resolves the Markdown leaf, not an arbitrary
	 * textarea. This bridge redirects only while a floating label is focused.
	 */
	private installEditingToolbarBridge(): void {
		this.installCommandExecutionBridge();
		this.installEditingToolbarColorCallbackBridge();
		// Community plugins are loaded independently. A second pass catches Editing Toolbar
		// when it finishes registering after this plugin.
		window.setTimeout(() => this.installEditingToolbarColorCallbackBridge(), 0);
	}

	private installCommandExecutionBridge(): void {
		if (this.commandBridgeInstalled) {
			return;
		}
		const commandManager = (this.app as unknown as { commands: ObsidianCommandsLike }).commands;
		if (typeof commandManager.executeCommandById !== 'function') {
			return;
		}
		this.nativeExecuteCommandById = commandManager.executeCommandById.bind(commandManager);
		commandManager.executeCommandById = (commandId: string): boolean => {
			const editor = this.getUsableFloatingEditor();
			if (!editor || !this.nativeExecuteCommandById) {
				return this.nativeExecuteCommandById?.(commandId) ?? false;
			}

			// Direct handlers cover the command IDs used by Editing Toolbar 4.x, including
			// its own editing-toolbar:* aliases. They do not depend on the active Markdown leaf.
			if (this.applyKnownFormattingCommand(commandId, editor)) {
				editor.focus();
				return true;
			}

			// For any Obsidian or third-party command that exposes editorCallback, pass the
			// textarea adapter directly. This permits compatible custom toolbar commands too.
			const command = commandManager.commands?.[commandId];
			if (typeof command?.editorCallback === 'function') {
				try {
					command.editorCallback(editor);
					editor.focus();
					return true;
				} catch (error) {
					console.warn(`Floating Text Overlay could not apply ${commandId} to the focused label.`, error);
				}
			}

			// Editing Toolbar commands without an editorCallback still consult
			// workspace.activeEditor. The temporary proxy below is active while the label has focus.
			return this.nativeExecuteCommandById(commandId);
		};
		this.commandBridgeInstalled = true;
	}

	private restoreEditingToolbarBridge(): void {
		this.restoreWorkspaceEditorBridge();
		this.restoreEditingToolbarColorCallbackBridge();
		if (!this.commandBridgeInstalled || !this.nativeExecuteCommandById) {
			return;
		}
		const commandManager = (this.app as unknown as { commands: ObsidianCommandsLike }).commands;
		commandManager.executeCommandById = this.nativeExecuteCommandById;
		this.nativeExecuteCommandById = undefined;
		this.commandBridgeInstalled = false;
	}

	/**
	 * Editing Toolbar's two palette commands are callback-only. In some toolbar layouts
	 * they invoke the stored callback directly instead of going through
	 * executeCommandById(), so also bridge those exact callbacks while a floating label
	 * owns focus. Normal note editing always falls back to the original callback.
	 */
	private installEditingToolbarColorCallbackBridge(): void {
		const commandManager = (this.app as unknown as { commands: ObsidianCommandsLike }).commands;
		const commands = commandManager.commands;
		if (!commands) {
			return;
		}

		const handlers: Array<{ id: string; apply: (editor: FloatingTextareaEditorBridge) => void }> = [
			{ id: 'editing-toolbar:change-font-color', apply: (editor) => this.applyEditingToolbarFontColor(editor) },
			{ id: 'editing-toolbar:change-background-color', apply: (editor) => this.applyEditingToolbarBackgroundColor(editor) }
		];

		for (const { id, apply } of handlers) {
			if (this.nativeEditingToolbarColorCallbacks.has(id)) {
				continue;
			}
			const command = commands[id];
			if (!command) {
				continue;
			}

			const nativeCallback = command.callback;
			this.nativeEditingToolbarColorCallbacks.set(id, nativeCallback);
			command.callback = () => {
				const editor = this.getUsableFloatingEditor();
				if (editor) {
					apply(editor);
					editor.focus();
					return;
				}
				return nativeCallback?.();
			};
		}
	}

	private restoreEditingToolbarColorCallbackBridge(): void {
		if (this.nativeEditingToolbarColorCallbacks.size === 0) {
			return;
		}
		const commandManager = (this.app as unknown as { commands: ObsidianCommandsLike }).commands;
		const commands = commandManager.commands;
		if (commands) {
			for (const [id, nativeCallback] of this.nativeEditingToolbarColorCallbacks) {
				const command = commands[id];
				if (command) {
					command.callback = nativeCallback;
				}
			}
		}
		this.nativeEditingToolbarColorCallbacks.clear();
	}

	private installWorkspaceEditorBridge(): void {
		if (this.workspaceEditorBridgeActive) {
			return;
		}
		const workspace = this.app.workspace as unknown as Record<string, unknown>;
		this.hadWorkspaceActiveEditorOwnProperty = Object.prototype.hasOwnProperty.call(workspace, 'activeEditor');
		this.workspaceActiveEditorOwnDescriptor = Object.getOwnPropertyDescriptor(workspace, 'activeEditor');
		const descriptor = this.findPropertyDescriptor(workspace, 'activeEditor');
		if (descriptor?.get) {
			this.nativeActiveEditorGetter = () => descriptor.get?.call(workspace);
		} else if ('value' in (descriptor ?? {})) {
			const value = descriptor?.value;
			this.nativeActiveEditorGetter = () => value;
		} else {
			this.nativeActiveEditorGetter = undefined;
		}

		try {
			Object.defineProperty(workspace, 'activeEditor', {
				configurable: true,
				enumerable: descriptor?.enumerable ?? true,
				get: () => {
					const nativeActiveEditor = this.nativeActiveEditorGetter?.();
					const floatingEditor = this.getUsableFloatingEditor();
					if (!floatingEditor) {
						return nativeActiveEditor;
					}
					const proxy = nativeActiveEditor && typeof nativeActiveEditor === 'object'
						? Object.create(nativeActiveEditor as object) as Record<string, unknown>
						: {};
					proxy.editor = floatingEditor;
					proxy.file = this.app.workspace.getActiveFile() ?? undefined;
					proxy.leaf = this.app.workspace.activeLeaf ?? undefined;
					return proxy;
				}
			});
			this.workspaceEditorBridgeActive = true;
		} catch (error) {
			console.warn('Floating Text Overlay could not expose the focused label to Editing Toolbar.', error);
		}
	}

	private restoreWorkspaceEditorBridge(): void {
		if (!this.workspaceEditorBridgeActive) {
			return;
		}
		const workspace = this.app.workspace as unknown as Record<string, unknown>;
		try {
			if (this.hadWorkspaceActiveEditorOwnProperty && this.workspaceActiveEditorOwnDescriptor) {
				Object.defineProperty(workspace, 'activeEditor', this.workspaceActiveEditorOwnDescriptor);
			} else {
				delete workspace.activeEditor;
			}
		} finally {
			this.workspaceEditorBridgeActive = false;
			this.nativeActiveEditorGetter = undefined;
			this.workspaceActiveEditorOwnDescriptor = undefined;
			this.hadWorkspaceActiveEditorOwnProperty = false;
		}
	}

	private findPropertyDescriptor(target: object, property: string): PropertyDescriptor | undefined {
		let current: object | null = target;
		while (current) {
			const descriptor = Object.getOwnPropertyDescriptor(current, property);
			if (descriptor) {
				return descriptor;
			}
			current = Object.getPrototypeOf(current) as object | null;
		}
		return undefined;
	}

	private activateFloatingEditorBridge(textarea: HTMLTextAreaElement): FloatingTextareaEditorBridge {
		if (this.bridgeReleaseTimer !== undefined) {
			window.clearTimeout(this.bridgeReleaseTimer);
			this.bridgeReleaseTimer = undefined;
		}
		if (this.activeFloatingEditor?.textarea === textarea) {
			this.installWorkspaceEditorBridge();
			this.installEditingToolbarColorCallbackBridge();
			return this.activeFloatingEditor;
		}
		this.activeFloatingEditor?.dispose();
		this.activeFloatingEditor = new FloatingTextareaEditorBridge(textarea);
		this.installWorkspaceEditorBridge();
		this.installEditingToolbarColorCallbackBridge();
		return this.activeFloatingEditor;
	}

	private getUsableFloatingEditor(): FloatingTextareaEditorBridge | undefined {
		const editor = this.activeFloatingEditor;
		return editor?.textarea.isConnected ? editor : undefined;
	}

	private scheduleFloatingEditorBridgeRelease(): void {
		if (this.bridgeReleaseTimer !== undefined) {
			window.clearTimeout(this.bridgeReleaseTimer);
		}
		// Editing Toolbar prevents button mousedown focus in several layouts, but other layouts
		// briefly blur the textarea. Retain the bridge only for this short click interval.
		this.bridgeReleaseTimer = window.setTimeout(() => this.deactivateFloatingEditorBridge(), 700);
	}

	private deactivateFloatingEditorBridge(): void {
		if (this.bridgeReleaseTimer !== undefined) {
			window.clearTimeout(this.bridgeReleaseTimer);
			this.bridgeReleaseTimer = undefined;
		}
		this.activeFloatingEditor?.dispose();
		this.activeFloatingEditor = undefined;
		this.restoreWorkspaceEditorBridge();
	}

	private applyKnownFormattingCommand(commandId: string, editor: FloatingTextareaEditorBridge): boolean {
		const id = commandId.toLowerCase();
		if (!id.startsWith('editing-toolbar:') && !id.startsWith('editor:')) {
			return false;
		}

		if (/(?:editor-undo|:undo)$/.test(id)) {
			editor.undo();
			return true;
		}
		if (/(?:editor-redo|:redo)$/.test(id)) {
			editor.redo();
			return true;
		}

		// Editing Toolbar 4.x registers font/background colour commands as callback-only
		// commands. Handle them here before the native callback resolves the Markdown editor.
		if (id.includes('change-font-color') || id.endsWith(':font-color')) {
			this.applyEditingToolbarFontColor(editor);
			return true;
		}
		if (id.includes('change-background-color') || id.endsWith(':background-color')) {
			this.applyEditingToolbarBackgroundColor(editor);
			return true;
		}

		if (id.includes('toggle-bold') || id.endsWith(':bold')) {
			this.toggleInlineWrapper(editor, '**', '**');
			return true;
		}
		if (id.includes('toggle-italics') || id.includes('toggle-italic') || id.endsWith(':italic')) {
			this.toggleInlineWrapper(editor, '*', '*');
			return true;
		}
		if (id.includes('toggle-strikethrough') || id.includes('strikethrough')) {
			this.toggleInlineWrapper(editor, '~~', '~~');
			return true;
		}
		if (id.includes('toggle-highlight') || id.includes(':highlight')) {
			this.toggleInlineWrapper(editor, '==', '==');
			return true;
		}
		if (id.endsWith(':underline') || id.includes('toggle-underline')) {
			this.toggleInlineWrapper(editor, '<u>', '</u>');
			return true;
		}
		if (id.includes('toggle-code') || id.endsWith(':code')) {
			this.toggleInlineWrapper(editor, '`', '`');
			return true;
		}
		if (id.includes('format-eraser') || id.includes('clear-formatting')) {
			this.clearInlineFormatting(editor);
			return true;
		}
		const headerMatch = id.match(/header[-:]?(?:text[-:]?)?([1-6])|heading[-:]?([1-6])/);
		if (headerMatch) {
			this.toggleLinePrefix(editor, `${'#'.repeat(Number(headerMatch[1] ?? headerMatch[2]))} `);
			return true;
		}
		if (id.includes('blockquote') || id.includes('block-quote')) {
			this.toggleLinePrefix(editor, '> ');
			return true;
		}
		if (id.includes('bullet-list') || id.includes('unordered-list') || id.includes('list-bullet')) {
			this.toggleLinePrefix(editor, '- ');
			return true;
		}
		if (id.includes('numbered-list') || id.includes('ordered-list') || id.includes('list-ordered')) {
			this.toggleLinePrefix(editor, '1. ');
			return true;
		}
		if (id.includes('checklist')) {
			this.toggleLinePrefix(editor, '- [ ] ');
			return true;
		}
		return false;
	}

	private toggleInlineWrapper(editor: FloatingTextareaEditorBridge, prefix: string, suffix: string): void {
		const selection = editor.getSelection();
		const from = editor.getCursor('from');
		const to = editor.getCursor('to');
		const prefixStart = { line: from.line, ch: Math.max(0, from.ch - prefix.length) };
		const suffixEnd = { line: to.line, ch: to.ch + suffix.length };
		const hasWrapper = editor.getRange(prefixStart, from) === prefix && editor.getRange(to, suffixEnd) === suffix;
		if (hasWrapper) {
			editor.replaceRange(selection, prefixStart, suffixEnd);
			editor.setSelection(prefixStart, { line: prefixStart.line, ch: prefixStart.ch + selection.length });
			return;
		}
		editor.replaceSelection(`${prefix}${selection}${suffix}`);
		const start = { line: from.line, ch: from.ch + prefix.length };
		const end = editor.offsetToPos(editor.posToOffset(start) + selection.length);
		editor.setSelection(start, end);
	}

	private toggleLinePrefix(editor: FloatingTextareaEditorBridge, prefix: string): void {
		const from = editor.getCursor('from');
		const to = editor.getCursor('to');
		const startLine = Math.min(from.line, to.line);
		const endLine = Math.max(from.line, to.line);
		const lines: string[] = [];
		let allPrefixed = true;
		for (let line = startLine; line <= endLine; line += 1) {
			const text = editor.getLine(line);
			lines.push(text);
			if (!text.startsWith(prefix)) {
				allPrefixed = false;
			}
		}
		const replacement = lines.map((text) => allPrefixed ? text.slice(prefix.length) : `${prefix}${text}`).join('\n');
		editor.replaceRange(replacement, { line: startLine, ch: 0 }, { line: endLine, ch: editor.getLine(endLine).length });
		const delta = allPrefixed ? -prefix.length : prefix.length;
		editor.setSelection(
			{ line: from.line, ch: Math.max(0, from.ch + delta) },
			{ line: to.line, ch: Math.max(0, to.ch + delta) }
		);
	}

	private clearInlineFormatting(editor: FloatingTextareaEditorBridge): void {
		const selection = editor.getSelection();
		if (!selection) {
			return;
		}
		const plain = selection
			.replace(/\*\*(.*?)\*\*/gs, '$1')
			.replace(/__(.*?)__/gs, '$1')
			.replace(/\*(.*?)\*/gs, '$1')
			.replace(/_(.*?)_/gs, '$1')
			.replace(/~~(.*?)~~/gs, '$1')
			.replace(/==(.*?)==/gs, '$1')
			.replace(/`(.*?)`/gs, '$1')
			.replace(/<u>(.*?)<\/u>/gis, '$1');
		editor.replaceSelection(plain);
	}


	/**
	 * Editing Toolbar's colour buttons use callback-only commands rather than an
	 * editorCallback. The original command reads the active Markdown editor, so a
	 * floating textarea needs an explicit, compatible implementation.
	 */
	private applyEditingToolbarFontColor(editor: FloatingTextareaEditorBridge): void {
		const selectedText = editor.getSelection();
		if (!selectedText || selectedText.trim().length === 0) {
			new Notice('Select text in the floating label before changing its font colour.');
			return;
		}

		const color = this.getEditingToolbarColor('cMenuFontColor', '#2DC26B');
		const colorTag = new RegExp(`^<font\\s+color=["']?${this.escapeRegExp(color)}["']?>([\\s\\S]+)<\\/font>$`, 'i');
		if (colorTag.test(selectedText.trim())) {
			return;
		}

		const fontColorRegex = /<font\s+color=["']?[^"'>]+["']?>([\s\S]*?)<\/font>/gim;
		const hasColorTag = fontColorRegex.test(selectedText);
		fontColorRegex.lastIndex = 0;
		const recolored = selectedText.replace(fontColorRegex, (_match, content: string) =>
			this.wrapNonEmptyLines(content, (line) => `<font color="${color}">${line}</font>`)
		);
		const finalText = hasColorTag
			? recolored
			: this.wrapNonEmptyLines(selectedText, (line) => `<font color="${color}">${line}</font>`);
		this.replaceSelectionAndKeepItSelected(editor, finalText);
	}

	private applyEditingToolbarBackgroundColor(editor: FloatingTextareaEditorBridge): void {
		const selectedText = editor.getSelection();
		if (!selectedText || selectedText.trim().length === 0) {
			new Notice('Select text in the floating label before changing its highlight colour.');
			return;
		}

		const color = this.getEditingToolbarColor('cMenuBackgroundColor', 'rgba(255, 212, 59, 0.55)');
		const escapedColor = this.escapeRegExp(color);
		const exactMark = new RegExp(`^<mark\\s+style=["']?background:${escapedColor}["']?>([\\s\\S]+)<\\/mark>$`, 'i');
		if (exactMark.test(selectedText.trim())) {
			return;
		}

		const backgroundRegex = /<mark\s+style=["']?background\s*:\s*(?:#[0-9a-f]{3,8}|rgba?\([^)]*\))\s*;?["']?>([\s\S]*?)<\/mark>/gim;
		const hasBackgroundTag = backgroundRegex.test(selectedText);
		backgroundRegex.lastIndex = 0;
		const recolored = selectedText.replace(backgroundRegex, (_match, content: string) =>
			this.wrapNonEmptyLines(content, (line) => `<mark style="background:${color}">${line}</mark>`)
		);
		const finalText = hasBackgroundTag
			? recolored
			: this.wrapNonEmptyLines(selectedText, (line) => `<mark style="background:${color}">${line}</mark>`);
		this.replaceSelectionAndKeepItSelected(editor, finalText);
	}

	private replaceSelectionAndKeepItSelected(editor: FloatingTextareaEditorBridge, replacement: string): void {
		const startOffset = editor.posToOffset(editor.getCursor('from'));
		editor.replaceSelection(replacement);
		editor.setSelection(
			editor.offsetToPos(startOffset),
			editor.offsetToPos(startOffset + replacement.length)
		);
	}

	private wrapNonEmptyLines(text: string, wrap: (line: string) => string): string {
		return text.split('\n').map((line) => line.trim() ? wrap(line) : line).join('\n');
	}

	private getEditingToolbarColor(settingKey: 'cMenuFontColor' | 'cMenuBackgroundColor', fallback: string): string {
		const pluginManager = (this.app as unknown as { plugins?: PluginRegistryLike }).plugins;
		const editingToolbar = pluginManager?.getPlugin?.('editing-toolbar')
			?? pluginManager?.plugins?.['editing-toolbar'];
		const candidate = editingToolbar?.settings?.[settingKey];
		return this.isSafeCssColor(candidate) ? candidate.trim() : fallback;
	}

	private isSafeCssColor(value: unknown): value is string {
		if (typeof value !== 'string') {
			return false;
		}
		const normalized = value.trim();
		if (normalized.length === 0 || normalized.length > 80 || /[;<>"']/.test(normalized)) {
			return false;
		}
		return /^#[0-9a-f]{3,8}$/i.test(normalized)
			|| /^rgba?\(\s*[^)]+\s*\)$/i.test(normalized)
			|| /^[a-z]+$/i.test(normalized);
	}

	private escapeRegExp(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	private async loadStore(): Promise<void> {
		const saved = (await this.loadData()) as Partial<FloatingTextStore> | null;
		const normalizedNotes: Record<string, FloatingTextBox[]> = {};

		for (const [path, rawBoxes] of Object.entries(saved?.notes ?? {})) {
			if (!Array.isArray(rawBoxes)) {
				continue;
			}
			normalizedNotes[path] = rawBoxes.map((rawBox) => this.normalizeBox(rawBox));
		}

		// v4 recovery data is intentionally ignored in v6. Existing labels remain intact.
		this.store = {
			version: 6,
			notes: normalizedNotes
		};
	}

	private isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === 'object' && value !== null;
	}

	private normalizeBox(rawBox: Partial<FloatingTextBox>): FloatingTextBox {
		const legacyPlaceholder = rawBox.markdown === EMPTY_PLACEHOLDER || rawBox.markdown === 'Type here...';
		const markdown = typeof rawBox.markdown === 'string' && !legacyPlaceholder ? rawBox.markdown : '';

		return {
			id: typeof rawBox.id === 'string' && rawBox.id.length > 0 ? rawBox.id : crypto.randomUUID(),
			x: this.isFiniteNumber(rawBox.x) ? Math.max(0, rawBox.x) : 72,
			y: this.isFiniteNumber(rawBox.y) ? Math.max(0, rawBox.y) : 72,
			width: this.isFiniteNumber(rawBox.width) ? Math.max(MIN_WIDTH, rawBox.width) : DEFAULT_WIDTH,
			height: this.isFiniteNumber(rawBox.height) ? Math.max(MIN_HEIGHT, rawBox.height) : DEFAULT_HEIGHT,
			markdown,
			color: this.isHexColor(rawBox.color) ? rawBox.color.toUpperCase() : DEFAULT_COLOR,
			opacity: this.isFiniteNumber(rawBox.opacity)
				? this.clamp(rawBox.opacity, 0.2, 1)
				: DEFAULT_OPACITY,
			visible: rawBox.visible !== false,
			updatedAt: typeof rawBox.updatedAt === 'string' ? rawBox.updatedAt : new Date().toISOString(),
			anchor: this.normalizeAnchor(rawBox.anchor)
		};
	}

	private normalizeAnchor(rawAnchor: TextAnchor | undefined): TextAnchor | undefined {
		if (!rawAnchor || typeof rawAnchor.text !== 'string' || rawAnchor.text.length === 0) {
			return undefined;
		}
		if (!this.isFiniteNumber(rawAnchor.start) || !this.isFiniteNumber(rawAnchor.end)) {
			return undefined;
		}

		return {
			text: rawAnchor.text,
			start: Math.max(0, rawAnchor.start),
			end: Math.max(0, rawAnchor.end),
			occurrence: this.isFiniteNumber(rawAnchor.occurrence) ? Math.max(0, rawAnchor.occurrence) : 0,
			contextBefore: typeof rawAnchor.contextBefore === 'string' ? rawAnchor.contextBefore : undefined,
			contextAfter: typeof rawAnchor.contextAfter === 'string' ? rawAnchor.contextAfter : undefined
		};
	}

	private isFiniteNumber(value: unknown): value is number {
		return typeof value === 'number' && Number.isFinite(value);
	}

	private isHexColor(value: unknown): value is string {
		return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value);
	}

	private persistStore(): Promise<void> {
		this.saveTimer = undefined;
		const snapshot = JSON.parse(JSON.stringify(this.store)) as FloatingTextStore;
		this.saveQueue = this.saveQueue.catch(() => undefined).then(() => this.saveData(snapshot));
		return this.saveQueue;
	}

	private scheduleSave(): void {
		if (this.saveTimer !== undefined) {
			window.clearTimeout(this.saveTimer);
		}

		this.saveTimer = window.setTimeout(() => {
			void this.persistStore();
		}, 350);
	}

	private getPersistedBoxes(file: TFile): FloatingTextBox[] {
		return this.store.notes[file.path] ?? [];
	}

	private getDraftBoxes(file: TFile): FloatingTextBox[] {
		return this.draftBoxes[file.path] ?? [];
	}

	private getBoxes(file: TFile): FloatingTextBox[] {
		return [...this.getPersistedBoxes(file), ...this.getDraftBoxes(file)];
	}

	private getBoxesByPath(filePath: string): FloatingTextBox[] {
		return [...(this.store.notes[filePath] ?? []), ...(this.draftBoxes[filePath] ?? [])];
	}

	private getOrCreatePersistedBoxes(file: TFile): FloatingTextBox[] {
		const existing = this.store.notes[file.path];
		if (existing) {
			return existing;
		}
		const boxes: FloatingTextBox[] = [];
		this.store.notes[file.path] = boxes;
		return boxes;
	}

	private getOrCreateDraftBoxes(file: TFile): FloatingTextBox[] {
		const existing = this.draftBoxes[file.path];
		if (existing) {
			return existing;
		}
		const boxes: FloatingTextBox[] = [];
		this.draftBoxes[file.path] = boxes;
		return boxes;
	}

	private isDraftBox(file: TFile, box: FloatingTextBox): boolean {
		return this.getDraftBoxes(file).some((candidate) => candidate.id === box.id);
	}

	/** Commit an in-memory draft only after a real user action. */
	private commitDraftBox(file: TFile, box: FloatingTextBox): boolean {
		const drafts = this.getDraftBoxes(file);
		const index = drafts.findIndex((candidate) => candidate.id === box.id);
		if (index < 0) {
			return false;
		}
		drafts.splice(index, 1);
		if (drafts.length === 0) {
			delete this.draftBoxes[file.path];
		}
		this.getOrCreatePersistedBoxes(file).push(box);
		return true;
	}

	private removeDraftBox(file: TFile, boxId: string): boolean {
		const drafts = this.getDraftBoxes(file);
		const index = drafts.findIndex((candidate) => candidate.id === boxId);
		if (index < 0) {
			return false;
		}
		drafts.splice(index, 1);
		if (drafts.length === 0) {
			delete this.draftBoxes[file.path];
		}
		return true;
	}

	private touchBox(box: FloatingTextBox): void {
		box.updatedAt = new Date().toISOString();
	}

	private addTextBoxToActiveNote(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;

		if (!view || !file) {
			new Notice('Open a Markdown note before adding a floating text box.');
			return;
		}

		const offset = this.getBoxes(file).length * 28;
		const anchor = this.captureEditorSelection(view);
		// Store coordinates in document space. A label created partway down a note
		// therefore stays with that part of the page while the note scrolls.
		const scroll = this.getViewScrollMetrics(view);
		this.getOrCreateDraftBoxes(file).push({
			id: crypto.randomUUID(),
			x: scroll.left + 72 + offset,
			y: scroll.top + 72 + offset,
			width: DEFAULT_WIDTH,
			height: DEFAULT_HEIGHT,
			markdown: '',
			color: DEFAULT_COLOR,
			opacity: DEFAULT_OPACITY,
			visible: true,
			updatedAt: new Date().toISOString(),
			anchor
		});

		// A just-created empty label is a transient draft. It is not written to data.json
		// until the user edits, moves, resizes, styles, previews, or explicitly links it.
		this.refreshLinkedTextMarkers();
		this.renderAllMarkdownViews();
		new Notice(anchor ? 'Draft floating text box added and linked to the selected text.' : 'Draft floating text box added.');
	}

	private removeAllBoxesFromActiveNote(): void {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice('No Markdown note is active.');
			return;
		}

		const boxes = this.getBoxes(file);
		if (boxes.length === 0) {
			new Notice('This note has no floating text boxes.');
			return;
		}
		const hadPersistedBoxes = this.getPersistedBoxes(file).length > 0;
		delete this.store.notes[file.path];
		delete this.draftBoxes[file.path];
		if (hadPersistedBoxes) {
			this.scheduleSave();
		}
		this.refreshLinkedTextMarkers();
		this.renderAllMarkdownViews();
		new Notice('All floating text boxes were deleted.');
	}

	private renderAllMarkdownViews(): void {
		this.closeContextPopover();
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			if (leaf.view instanceof MarkdownView) {
				this.renderView(leaf.view);
			}
		}
	}

	private renderView(view: MarkdownView): void {
		const host = view.contentEl;
		this.removeRenderedLayer(host);

		const file = view.file;
		if (!file) {
			return;
		}

		host.classList.add('floating-text-overlay__host');
		const layer = document.createElement('div');
		layer.className = 'floating-text-overlay__layer';
		host.appendChild(layer);
		this.bindLayerToDocumentScroll(view, layer);

		for (const box of this.getBoxes(file)) {
			if (box.visible) {
				this.renderBox(layer, file, box);
			}
		}
	}

	private renderBox(layer: HTMLElement, file: TFile, box: FloatingTextBox): void {
		const boxEl = document.createElement('section');
		boxEl.className = 'floating-text-overlay__box';
		boxEl.dataset.boxId = box.id;
		boxEl.setAttribute('aria-label', 'Floating text box');
		boxEl.classList.toggle('is-linked', Boolean(box.anchor));
		this.applyBoxGeometry(boxEl, box);
		this.applyBoxAppearance(boxEl, box);

		const header = document.createElement('div');
		header.className = 'floating-text-overlay__header';
		header.title = 'Drag to move';

		const dragIcon = document.createElement('span');
		dragIcon.className = 'floating-text-overlay__drag-icon';
		dragIcon.textContent = '⠿';
		dragIcon.setAttribute('aria-hidden', 'true');

		const headerTitle = document.createElement('span');
		headerTitle.className = 'floating-text-overlay__header-title';
		headerTitle.textContent = 'Floating text';

		const linkBadge = document.createElement('span');
		linkBadge.className = 'floating-text-overlay__link-badge';
		if (box.anchor) {
			linkBadge.textContent = 'Linked';
			linkBadge.title = `Linked to: ${this.truncate(box.anchor.text, 60)}`;
		} else {
			linkBadge.textContent = 'Unlinked';
			linkBadge.title = 'This label is not linked to note text.';
		}

		const deleteButton = document.createElement('button');
		deleteButton.className = 'floating-text-overlay__delete';
		deleteButton.type = 'button';
		deleteButton.textContent = '×';
		deleteButton.title = 'Delete this text box';
		deleteButton.setAttribute('aria-label', 'Delete this text box');

		header.append(dragIcon, headerTitle, linkBadge, deleteButton);

		const body = document.createElement('div');
		body.className = 'floating-text-overlay__body';

		const textarea = document.createElement('textarea');
		textarea.className = 'floating-text-overlay__editor';
		textarea.value = box.markdown;
		textarea.placeholder = EMPTY_PLACEHOLDER;
		textarea.setAttribute('aria-label', 'Floating text');
		textarea.spellcheck = true;

		const preview = document.createElement('div');
		preview.className = 'floating-text-overlay__preview is-hidden';

		const footer = document.createElement('div');
		footer.className = 'floating-text-overlay__footer';
		const previewButton = document.createElement('button');
		previewButton.type = 'button';
		previewButton.textContent = 'Preview Markdown';
		previewButton.title = 'Show rendered Markdown';
		footer.appendChild(previewButton);

		const resizeHandle = document.createElement('div');
		resizeHandle.className = 'floating-text-overlay__resize-handle';
		resizeHandle.title = 'Drag to resize';
		resizeHandle.setAttribute('role', 'separator');
		resizeHandle.setAttribute('aria-label', 'Drag to resize this text box');

		body.append(textarea, preview);
		boxEl.append(header, body, footer, resizeHandle);
		layer.appendChild(boxEl);

		textarea.addEventListener('input', () => {
			box.markdown = textarea.value;
			this.commitDraftBox(file, box);
			this.touchBox(box);
			this.scheduleSave();
		});

		textarea.addEventListener('focus', () => {
			boxEl.classList.add('is-editing');
			this.activateFloatingEditorBridge(textarea);
		});
		textarea.addEventListener('blur', () => {
			boxEl.classList.remove('is-editing');
			this.scheduleFloatingEditorBridgeRelease();
		});

		previewButton.addEventListener('click', async () => {
			const openingPreview = preview.classList.contains('is-hidden');
			if (!openingPreview) {
				preview.classList.add('is-hidden');
				textarea.classList.remove('is-hidden');
				previewButton.textContent = 'Preview Markdown';
				textarea.focus();
				return;
			}

			box.markdown = textarea.value;
			this.commitDraftBox(file, box);
			this.touchBox(box);
			this.scheduleSave();
			preview.replaceChildren();
			await MarkdownRenderer.renderMarkdown(box.markdown, preview, file.path, this);
			textarea.classList.add('is-hidden');
			preview.classList.remove('is-hidden');
			previewButton.textContent = 'Back to edit';
		});

		deleteButton.addEventListener('click', () => {
			if (this.deleteBox(file, box.id)) {
				boxEl.remove();
			}
		});

		boxEl.addEventListener('contextmenu', (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			this.openContextPopover(event, boxEl, file, box);
		});

		this.attachDragBehavior(file, header, boxEl, layer, box);
		this.attachResizeBehavior(file, resizeHandle, boxEl, layer, box);
	}

	/**
	 * Locate the element that currently owns note scrolling. Source mode commonly uses
	 * CodeMirror's .cm-scroller, while Reading View may use a view-content ancestor.
	 */
	private getScrollableCandidates(view: MarkdownView): HTMLElement[] {
		const host = view.contentEl;
		const candidates: HTMLElement[] = [];
		const add = (element: Element | null): void => {
			if (element instanceof HTMLElement && !candidates.includes(element)) {
				candidates.push(element);
			}
		};

		add(host.querySelector('.cm-scroller'));
		add(host.querySelector('.markdown-preview-view'));
		add(host.querySelector('.view-content'));
		add(host);

		let parent: HTMLElement | null = host.parentElement;
		let depth = 0;
		while (parent && depth < 5) {
			add(parent);
			if (parent.classList.contains('workspace-leaf-content')) {
				break;
			}
			parent = parent.parentElement;
			depth += 1;
		}
		return candidates;
	}

	private isScrollableElement(element: HTMLElement): boolean {
		const style = window.getComputedStyle(element);
		const permitsScroll = /(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflowX}`);
		return permitsScroll && (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1);
	}

	private getPrimaryScrollContainer(view: MarkdownView): HTMLElement {
		const candidates = this.getScrollableCandidates(view);
		return candidates.find((candidate) => this.isScrollableElement(candidate)) ?? view.contentEl;
	}

	private getScrollMetrics(view: MarkdownView, scroller: HTMLElement): ScrollMetrics {
		const hostRect = view.contentEl.getBoundingClientRect();
		const scrollerRect = scroller.getBoundingClientRect();
		return {
			left: scroller.scrollLeft,
			top: scroller.scrollTop,
			viewportWidth: Math.max(1, scroller.clientWidth),
			viewportHeight: Math.max(1, scroller.clientHeight),
			contentWidth: Math.max(scroller.scrollWidth, scroller.clientWidth),
			contentHeight: Math.max(scroller.scrollHeight, scroller.clientHeight),
			originX: scrollerRect.left - hostRect.left,
			originY: scrollerRect.top - hostRect.top
		};
	}

	private getViewScrollMetrics(view: MarkdownView): ScrollMetrics {
		return this.getScrollMetrics(view, this.getPrimaryScrollContainer(view));
	}

	private getLayerScrollMetrics(layer: HTMLElement): ScrollMetrics {
		const binding = this.layerScrollBindings.get(layer);
		if (binding) {
			return this.getScrollMetrics(binding.view, binding.primaryScroller);
		}
		return {
			left: 0,
			top: 0,
			viewportWidth: layer.clientWidth,
			viewportHeight: layer.clientHeight,
			contentWidth: layer.clientWidth,
			contentHeight: layer.clientHeight,
			originX: 0,
			originY: 0
		};
	}

	private updateLayerScrollTransform(layer: HTMLElement): void {
		const binding = this.layerScrollBindings.get(layer);
		if (!binding || !layer.isConnected) {
			return;
		}
		const metrics = this.getScrollMetrics(binding.view, binding.primaryScroller);
		// `box.x` / `box.y` are document coordinates. This translation keeps a label
		// aligned with its original text position as the Markdown page moves underneath.
		layer.style.transform = `translate3d(${metrics.originX - metrics.left}px, ${metrics.originY - metrics.top}px, 0)`;
	}

	private bindLayerToDocumentScroll(view: MarkdownView, layer: HTMLElement): void {
		const abort = new AbortController();
		let scheduleSync: (event?: Event) => void = () => undefined;
		const binding: LayerScrollBinding = {
			view,
			primaryScroller: this.getPrimaryScrollContainer(view),
			abort,
			resizeObserver: new ResizeObserver(() => scheduleSync()),
			animationFrame: undefined
		};
		scheduleSync = (event?: Event): void => {
			const source = event?.currentTarget;
			if (source instanceof HTMLElement && this.isScrollableElement(source)) {
				binding.primaryScroller = source;
			} else {
				binding.primaryScroller = this.getPrimaryScrollContainer(view);
			}
			if (binding.animationFrame !== undefined) {
				return;
			}
			binding.animationFrame = window.requestAnimationFrame(() => {
				binding.animationFrame = undefined;
				this.updateLayerScrollTransform(layer);
			});
		};

		this.layerScrollBindings.set(layer, binding);
		for (const candidate of this.getScrollableCandidates(view)) {
			candidate.addEventListener('scroll', scheduleSync, { passive: true, signal: abort.signal });
		}
		window.addEventListener('resize', scheduleSync, { passive: true, signal: abort.signal });
		binding.resizeObserver.observe(view.contentEl);
		binding.resizeObserver.observe(binding.primaryScroller);
		scheduleSync();
	}

	private disposeLayerScrollBinding(layer: HTMLElement): void {
		const binding = this.layerScrollBindings.get(layer);
		if (!binding) {
			return;
		}
		binding.abort.abort();
		binding.resizeObserver.disconnect();
		if (binding.animationFrame !== undefined) {
			window.cancelAnimationFrame(binding.animationFrame);
		}
		this.layerScrollBindings.delete(layer);
	}

	private applyBoxGeometry(boxEl: HTMLElement, box: FloatingTextBox): void {
		boxEl.style.left = `${box.x}px`;
		boxEl.style.top = `${box.y}px`;
		boxEl.style.width = `${box.width}px`;
		boxEl.style.height = `${box.height}px`;
	}

	private applyBoxAppearance(boxEl: HTMLElement, box: FloatingTextBox): void {
		const background = this.hexToRgba(box.color, box.opacity);
		const border = this.hexToRgba(box.color, Math.min(1, box.opacity + 0.04));
		boxEl.style.setProperty('--floating-text-overlay-bg', background);
		boxEl.style.setProperty('--floating-text-overlay-border', border);
	}

	private hexToRgba(hex: string, alpha: number): string {
		const red = Number.parseInt(hex.slice(1, 3), 16);
		const green = Number.parseInt(hex.slice(3, 5), 16);
		const blue = Number.parseInt(hex.slice(5, 7), 16);
		return `rgba(${red}, ${green}, ${blue}, ${this.clamp(alpha, 0, 1)})`;
	}

	private deleteBox(file: TFile, boxId: string): boolean {
		if (this.removeDraftBox(file, boxId)) {
			this.refreshLinkedTextMarkers();
			this.closeContextPopover();
			return true;
		}

		const boxes = this.getPersistedBoxes(file);
		const index = boxes.findIndex((item) => item.id === boxId);
		if (index < 0) {
			return false;
		}
		boxes.splice(index, 1);
		if (boxes.length === 0) {
			delete this.store.notes[file.path];
		}
		this.scheduleSave();
		this.refreshLinkedTextMarkers();
		this.closeContextPopover();
		return true;
	}

	private attachDragBehavior(
		file: TFile,
		handle: HTMLElement,
		boxEl: HTMLElement,
		layer: HTMLElement,
		box: FloatingTextBox
	): void {
		handle.addEventListener('pointerdown', (event: PointerEvent) => {
			if (event.button !== 0 || event.target instanceof HTMLButtonElement) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			boxEl.classList.add('is-dragging');
			handle.setPointerCapture(event.pointerId);

			const startPointerX = event.clientX;
			const startPointerY = event.clientY;
			const startBoxX = box.x;
			const startBoxY = box.y;

			const move = (moveEvent: PointerEvent): void => {
				if (moveEvent.pointerId !== event.pointerId) {
					return;
				}

				const metrics = this.getLayerScrollMetrics(layer);
				const maxX = Math.max(0, metrics.contentWidth - box.width);
				const maxY = Math.max(0, metrics.contentHeight - box.height);
				box.x = this.clamp(startBoxX + moveEvent.clientX - startPointerX, 0, maxX);
				box.y = this.clamp(startBoxY + moveEvent.clientY - startPointerY, 0, maxY);
				this.applyBoxGeometry(boxEl, box);
			};

			const stop = (stopEvent: PointerEvent): void => {
				if (stopEvent.pointerId !== event.pointerId) {
					return;
				}

				boxEl.classList.remove('is-dragging');
				this.commitDraftBox(file, box);
				this.touchBox(box);
				handle.removeEventListener('pointermove', move);
				handle.removeEventListener('pointerup', stop);
				handle.removeEventListener('pointercancel', stop);
				this.scheduleSave();
			};

			handle.addEventListener('pointermove', move);
			handle.addEventListener('pointerup', stop);
			handle.addEventListener('pointercancel', stop);
		});
	}

	private attachResizeBehavior(
		file: TFile,
		handle: HTMLElement,
		boxEl: HTMLElement,
		layer: HTMLElement,
		box: FloatingTextBox
	): void {
		handle.addEventListener('pointerdown', (event: PointerEvent) => {
			if (event.button !== 0) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			boxEl.classList.add('is-resizing');
			handle.setPointerCapture(event.pointerId);

			const startPointerX = event.clientX;
			const startPointerY = event.clientY;
			const startWidth = box.width;
			const startHeight = box.height;

			const move = (moveEvent: PointerEvent): void => {
				if (moveEvent.pointerId !== event.pointerId) {
					return;
				}

				const metrics = this.getLayerScrollMetrics(layer);
				const maxWidth = Math.max(MIN_WIDTH, metrics.contentWidth - box.x);
				const maxHeight = Math.max(MIN_HEIGHT, metrics.contentHeight - box.y);
				box.width = this.clamp(startWidth + moveEvent.clientX - startPointerX, MIN_WIDTH, maxWidth);
				box.height = this.clamp(startHeight + moveEvent.clientY - startPointerY, MIN_HEIGHT, maxHeight);
				this.applyBoxGeometry(boxEl, box);
			};

			const stop = (stopEvent: PointerEvent): void => {
				if (stopEvent.pointerId !== event.pointerId) {
					return;
				}

				boxEl.classList.remove('is-resizing');
				this.commitDraftBox(file, box);
				this.touchBox(box);
				handle.removeEventListener('pointermove', move);
				handle.removeEventListener('pointerup', stop);
				handle.removeEventListener('pointercancel', stop);
				this.scheduleSave();
			};

			handle.addEventListener('pointermove', move);
			handle.addEventListener('pointerup', stop);
			handle.addEventListener('pointercancel', stop);
		});
	}

	private captureEditorSelection(view: MarkdownView): TextAnchor | undefined {
		const selectedText = view.editor.getSelection();
		if (!selectedText || selectedText.trim().length === 0) {
			return undefined;
		}

		const source = view.editor.getValue();
		const from = view.editor.getCursor('from');
		const to = view.editor.getCursor('to');
		const start = this.positionToOffset(source, from);
		const end = this.positionToOffset(source, to);
		if (end <= start) {
			return undefined;
		}

		return {
			text: selectedText,
			start,
			end,
			occurrence: this.countOccurrences(source.slice(0, start), selectedText),
			contextBefore: source.slice(Math.max(0, start - ANCHOR_CONTEXT_LENGTH), start),
			contextAfter: source.slice(end, Math.min(source.length, end + ANCHOR_CONTEXT_LENGTH))
		};
	}

	private linkBoxToCurrentSelection(file: TFile, box: FloatingTextBox): boolean {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || activeView.file?.path !== file.path) {
			new Notice('Keep this note active, select text in the editor, then link the label.');
			return false;
		}

		const anchor = this.captureEditorSelection(activeView);
		if (!anchor) {
			new Notice('Select non-empty text in the Markdown editor before linking this label.');
			return false;
		}

		box.anchor = anchor;
		this.commitDraftBox(file, box);
		this.touchBox(box);
		this.scheduleSave();
		this.refreshLinkedTextMarkers();
		this.renderAllMarkdownViews();
		new Notice('Label linked to the selected text.');
		return true;
	}

	private unlinkBox(box: FloatingTextBox): void {
		if (!box.anchor) {
			return;
		}
		delete box.anchor;
		this.touchBox(box);
		this.scheduleSave();
		this.refreshLinkedTextMarkers();
		this.renderAllMarkdownViews();
		new Notice('Text link removed from this label.');
	}

	private locateLinkedText(file: TFile, box: FloatingTextBox): void {
		if (!box.anchor) {
			new Notice('This label is not linked to note text.');
			return;
		}

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || view.file?.path !== file.path) {
			new Notice('Open this note in the Markdown editor before locating the linked text.');
			return;
		}

		const source = view.editor.getValue();
		const resolved = this.resolveAnchor(source, box.anchor);
		if (!resolved) {
			new Notice('The linked text could not be found. The text may have been deleted or changed.');
			return;
		}

		box.anchor.start = resolved.start;
		box.anchor.end = resolved.end;
		box.anchor.occurrence = this.countOccurrences(source.slice(0, resolved.start), box.anchor.text);
		this.touchBox(box);
		this.scheduleSave();

		const from = this.offsetToPosition(source, resolved.start);
		const to = this.offsetToPosition(source, resolved.end);
		view.editor.setSelection(from, to);
		view.editor.scrollIntoView({ from, to }, true);
		this.closeContextPopover();
	}

	private resolveAnchor(source: string, anchor: TextAnchor): { start: number; end: number } | undefined {
		if (anchor.end > anchor.start && source.slice(anchor.start, anchor.end) === anchor.text) {
			return { start: anchor.start, end: anchor.end };
		}

		// A saved link may be opened after edits were made while no editor extension was active.
		// In that case use surrounding context first, then the stored occurrence, then proximity.
		const contextMatch = this.resolveAnchorByContext(source, anchor);
		if (contextMatch) {
			return contextMatch;
		}

		const positions = this.findAllOccurrences(source, anchor.text);
		if (positions.length === 0) {
			return undefined;
		}

		const occurrencePosition = positions[anchor.occurrence];
		if (occurrencePosition !== undefined) {
			return { start: occurrencePosition, end: occurrencePosition + anchor.text.length };
		}

		const nearest = positions.reduce((best, current) =>
			Math.abs(current - anchor.start) < Math.abs(best - anchor.start) ? current : best
		);
		return { start: nearest, end: nearest + anchor.text.length };
	}

	private resolveAnchorByContext(source: string, anchor: TextAnchor): { start: number; end: number } | undefined {
		const before = anchor.contextBefore ?? '';
		const after = anchor.contextAfter ?? '';
		if (!before && !after) {
			return undefined;
		}

		const candidates: Array<{ start: number; end: number }> = [];
		if (before && after) {
			let beforeIndex = source.indexOf(before);
			while (beforeIndex !== -1) {
				const start = beforeIndex + before.length;
				const afterIndex = source.indexOf(after, start);
				if (afterIndex !== -1) {
					candidates.push({ start, end: afterIndex });
				}
				beforeIndex = source.indexOf(before, beforeIndex + 1);
			}
		} else if (before) {
			const start = source.indexOf(before);
			if (start !== -1) {
				candidates.push({ start: start + before.length, end: start + before.length + anchor.text.length });
			}
		} else if (after) {
			const end = source.indexOf(after);
			if (end !== -1) {
				candidates.push({ start: Math.max(0, end - anchor.text.length), end });
			}
		}

		if (candidates.length === 0) {
			return undefined;
		}
		return candidates.reduce((best, current) =>
			Math.abs(current.start - anchor.start) < Math.abs(best.start - anchor.start) ? current : best
		);
	}

	private findAllOccurrences(source: string, target: string): number[] {
		const positions: number[] = [];
		if (target.length === 0) {
			return positions;
		}

		let index = source.indexOf(target);
		while (index !== -1) {
			positions.push(index);
			index = source.indexOf(target, index + target.length);
		}
		return positions;
	}

	private countOccurrences(source: string, target: string): number {
		return this.findAllOccurrences(source, target).length;
	}

	private positionToOffset(source: string, position: { line: number; ch: number }): number {
		const lines = source.split('\n');
		const lineIndex = this.clamp(position.line, 0, Math.max(0, lines.length - 1));
		let offset = 0;
		for (let index = 0; index < lineIndex; index += 1) {
			offset += (lines[index]?.length ?? 0) + 1;
		}
		return offset + this.clamp(position.ch, 0, lines[lineIndex]?.length ?? 0);
	}

	private offsetToPosition(source: string, targetOffset: number): { line: number; ch: number } {
		const offset = this.clamp(targetOffset, 0, source.length);
		const before = source.slice(0, offset);
		const line = before.split('\n').length - 1;
		const lastBreak = before.lastIndexOf('\n');
		return {
			line,
			ch: offset - lastBreak - 1
		};
	}

	private openContextPopover(event: MouseEvent, boxEl: HTMLElement, file: TFile, box: FloatingTextBox): void {
		this.closeContextPopover();

		const popover = document.createElement('section');
		popover.className = 'floating-text-overlay__context-popover';
		popover.setAttribute('role', 'dialog');
		popover.setAttribute('aria-label', 'Floating text box options');
		popover.addEventListener('contextmenu', (contextEvent) => contextEvent.preventDefault());

		const title = document.createElement('div');
		title.className = 'floating-text-overlay__context-title';
		title.textContent = 'Label options';
		popover.appendChild(title);

		if (box.anchor) {
			const linkSummary = document.createElement('div');
			linkSummary.className = 'floating-text-overlay__link-summary';
			linkSummary.textContent = `Linked text: ${this.truncate(box.anchor.text, 76)}`;
			popover.appendChild(linkSummary);
		}

		const selectionAnchor = this.getSelectionForFile(file);
		const linkButton = this.createPopoverAction('Link current selection', () => {
			const linked = this.linkBoxToCurrentSelection(file, box);
			if (linked) {
				this.closeContextPopover();
			}
		});
		if (!selectionAnchor) {
			linkButton.disabled = true;
			linkButton.title = 'Select text in the active Markdown editor first.';
		}
		popover.appendChild(linkButton);

		if (box.anchor) {
			popover.appendChild(
				this.createPopoverAction('Locate linked text', () => this.locateLinkedText(file, box))
			);
			popover.appendChild(
				this.createPopoverAction('Remove text link', () => {
					this.unlinkBox(box);
					this.closeContextPopover();
				})
			);
		}

		popover.appendChild(this.createPopoverDivider());
		popover.appendChild(this.createAppearanceControls(file, boxEl, box));
		popover.appendChild(this.createPopoverDivider());
		popover.appendChild(
			this.createPopoverAction('Delete label', () => {
				if (this.deleteBox(file, box.id)) {
					boxEl.remove();
				}
			})
		);

		document.body.appendChild(popover);
		this.contextPopover = popover;
		this.positionPopover(popover, event.clientX, event.clientY);

		const abort = new AbortController();
		this.contextPopoverAbort = abort;
		document.addEventListener(
			'pointerdown',
			(pointerEvent: PointerEvent) => {
				if (popover.contains(pointerEvent.target as Node) || boxEl.contains(pointerEvent.target as Node)) {
					return;
				}
				this.closeContextPopover();
			},
			{ capture: true, signal: abort.signal }
		);
		document.addEventListener(
			'keydown',
			(keyEvent: KeyboardEvent) => {
				if (keyEvent.key === 'Escape') {
					this.closeContextPopover();
				}
			},
			{ signal: abort.signal }
		);
		window.addEventListener('resize', () => this.closeContextPopover(), { signal: abort.signal });
	}

	private getSelectionForFile(file: TFile): TextAnchor | undefined {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || view.file?.path !== file.path) {
			return undefined;
		}
		return this.captureEditorSelection(view);
	}

	private createPopoverAction(title: string, action: () => void): HTMLButtonElement {
		const button = document.createElement('button');
		button.className = 'floating-text-overlay__context-action';
		button.type = 'button';
		button.textContent = title;
		button.addEventListener('click', action);
		return button;
	}

	private createPopoverDivider(): HTMLElement {
		const divider = document.createElement('div');
		divider.className = 'floating-text-overlay__context-divider';
		return divider;
	}

	private createAppearanceControls(file: TFile, boxEl: HTMLElement, box: FloatingTextBox): HTMLElement {
		const appearance = document.createElement('div');
		appearance.className = 'floating-text-overlay__appearance-controls';

		const colorRow = document.createElement('label');
		colorRow.className = 'floating-text-overlay__control-row';
		const colorLabel = document.createElement('span');
		colorLabel.textContent = 'Color';
		const colorInput = document.createElement('input');
		colorInput.type = 'color';
		colorInput.value = box.color;
		colorInput.title = 'Choose label color';
		colorInput.addEventListener('input', () => {
			box.color = colorInput.value.toUpperCase();
			this.commitDraftBox(file, box);
			this.touchBox(box);
			this.applyBoxAppearance(boxEl, box);
			this.scheduleSave();
		});
		colorRow.append(colorLabel, colorInput);

		const opacityRow = document.createElement('label');
		opacityRow.className = 'floating-text-overlay__control-row floating-text-overlay__opacity-row';
		const opacityLabel = document.createElement('span');
		opacityLabel.textContent = 'Transparency';
		const opacityValue = document.createElement('output');
		opacityValue.textContent = `${Math.round(box.opacity * 100)}%`;
		const opacityInput = document.createElement('input');
		opacityInput.type = 'range';
		opacityInput.min = '20';
		opacityInput.max = '100';
		opacityInput.step = '5';
		opacityInput.value = String(Math.round(box.opacity * 100));
		opacityInput.addEventListener('input', () => {
			box.opacity = Number(opacityInput.value) / 100;
			this.commitDraftBox(file, box);
			this.touchBox(box);
			opacityValue.textContent = `${opacityInput.value}%`;
			this.applyBoxAppearance(boxEl, box);
			this.scheduleSave();
		});
		opacityRow.append(opacityLabel, opacityValue, opacityInput);

		appearance.append(colorRow, opacityRow);
		return appearance;
	}

	/**
	 * CodeMirror decoration for linked note text. The extension maps link ranges through
	 * every document transaction, so editing a linked sentence updates the stored anchor
	 * rather than silently dropping its visual marker.
	 */
	private createLinkedTextExtension(): Extension {
		const plugin = this;

		class LinkedTextViewPlugin implements PluginValue {
			decorations: DecorationSet;

			constructor(private readonly view: EditorView) {
				plugin.linkedEditorViews.add(view);
				this.decorations = plugin.buildLinkedTextDecorations(view);
			}

			update(update: ViewUpdate): void {
				const requestedRefresh = update.transactions.some((transaction) =>
					transaction.effects.some((effect) => effect.is(plugin.refreshLinkedTextEffect))
				);
				if (update.docChanged) {
					plugin.syncAnchorsThroughDocumentChange(update);
				}
				if (update.docChanged || update.viewportChanged || requestedRefresh) {
					this.decorations = plugin.buildLinkedTextDecorations(update.view);
				}
			}

			destroy(): void {
				plugin.linkedEditorViews.delete(this.view);
			}
		}

		return ViewPlugin.fromClass(LinkedTextViewPlugin, {
			decorations: (value) => value.decorations,
			eventHandlers: {
				mousedown(event): boolean | void {
					if (event.button !== 0 || (!event.ctrlKey && !event.metaKey)) {
						return false;
					}
					const target = event.target instanceof HTMLElement ? event.target : null;
					const marker = target?.closest('.floating-text-overlay__linked-text') as HTMLElement | null;
					if (!marker) {
						return false;
					}
					const rawIds = marker.dataset.floatingTextBoxIds;
					const filePath = marker.dataset.floatingTextFilePath;
					const boxIds = rawIds?.split(',').filter(Boolean) ?? [];
					if (!filePath || boxIds.length === 0) {
						return false;
					}

					event.preventDefault();
					event.stopPropagation();
					window.setTimeout(() => plugin.toggleLinkedBoxes(filePath, boxIds), 0);
					return true;
				}
			}
		});
	}

	private syncAnchorsThroughDocumentChange(update: ViewUpdate): void {
		const info = update.state.field(editorInfoField, false);
		const file = info?.file;
		if (!file) {
			return;
		}
		const boxes = this.getBoxesByPath(file.path);
		if (!boxes?.length) {
			return;
		}

		const source = update.state.doc.toString();
		let changed = false;
		for (const box of boxes) {
			const anchor = box.anchor;
			if (!anchor) {
				continue;
			}
			// Associations keep inserted/replaced characters at either edge inside the link.
			const mappedStart = update.changes.mapPos(anchor.start, -1);
			const mappedEnd = update.changes.mapPos(anchor.end, 1);
			const start = Math.max(0, Math.min(mappedStart, source.length));
			const end = Math.max(start, Math.min(mappedEnd, source.length));
			if (end <= start) {
				// Preserve the metadata after a full deletion. If the user immediately types at
				// the same location the following transaction expands it again.
				anchor.start = start;
				anchor.end = end;
				anchor.contextBefore = source.slice(Math.max(0, start - ANCHOR_CONTEXT_LENGTH), start);
				anchor.contextAfter = source.slice(end, Math.min(source.length, end + ANCHOR_CONTEXT_LENGTH));
				this.touchBox(box);
				changed = true;
				continue;
			}

			const text = source.slice(start, end);
			const occurrence = this.countOccurrences(source.slice(0, start), text);
			if (
				anchor.start !== start || anchor.end !== end || anchor.text !== text || anchor.occurrence !== occurrence ||
				anchor.contextBefore !== source.slice(Math.max(0, start - ANCHOR_CONTEXT_LENGTH), start) ||
				anchor.contextAfter !== source.slice(end, Math.min(source.length, end + ANCHOR_CONTEXT_LENGTH))
			) {
				anchor.start = start;
				anchor.end = end;
				anchor.text = text;
				anchor.occurrence = occurrence;
				anchor.contextBefore = source.slice(Math.max(0, start - ANCHOR_CONTEXT_LENGTH), start);
				anchor.contextAfter = source.slice(end, Math.min(source.length, end + ANCHOR_CONTEXT_LENGTH));
				this.touchBox(box);
				changed = true;
			}
		}

		if (changed) {
			this.scheduleSave();
			window.setTimeout(() => this.refreshLinkedTextMarkers(), 0);
		}
	}

	private buildLinkedTextDecorations(view: EditorView): DecorationSet {
		const info = view.state.field(editorInfoField, false);
		const file = info?.file;
		if (!file) {
			return Decoration.none;
		}

		const boxes = this.getBoxesByPath(file.path);
		if (boxes.length === 0) {
			return Decoration.none;
		}

		const source = view.state.doc.toString();
		const grouped = new Map<string, LinkedTextMarker>();
		for (const box of boxes) {
			if (!box.anchor) {
				continue;
			}
			const resolved = this.resolveAnchor(source, box.anchor);
			if (!resolved || resolved.end <= resolved.start) {
				continue;
			}
			const key = `${resolved.start}:${resolved.end}`;
			const marker = grouped.get(key);
			if (marker) {
				marker.boxIds.push(box.id);
			} else {
				grouped.set(key, {
					start: resolved.start,
					end: resolved.end,
					boxIds: [box.id],
					labelText: box.markdown.trim()
				});
			}
		}

		const markers = [...grouped.values()]
			.filter((marker) => view.visibleRanges.some((range) => marker.start < range.to && marker.end > range.from))
			.sort((left, right) => left.start - right.start || right.end - left.end);
		if (markers.length === 0) {
			return Decoration.none;
		}

		const builder = new RangeSetBuilder<Decoration>();
		let previousEnd = -1;
		for (const marker of markers) {
			if (marker.start < previousEnd) {
				continue;
			}
			const labelHint = marker.labelText ? ` — ${this.truncate(marker.labelText, 44)}` : '';
			builder.add(
				marker.start,
				marker.end,
				Decoration.mark({
					class: 'floating-text-overlay__linked-text',
					attributes: {
						'data-floating-text-box-ids': marker.boxIds.join(','),
						'data-floating-text-file-path': file.path,
						title: `Ctrl/Cmd+click to open or close linked label${labelHint}`
					}
				})
			);
			previousEnd = marker.end;
		}
		return builder.finish();
	}

	private refreshLinkedTextMarkers(): void {
		for (const view of this.linkedEditorViews) {
			try {
				view.dispatch({ effects: this.refreshLinkedTextEffect.of(undefined) });
			} catch {
				// A view can disappear while Obsidian is changing panes. It will recreate itself.
			}
		}
	}

	private toggleLinkedBoxes(filePath: string, boxIds: string[]): void {
		const boxes = this.getBoxesByPath(filePath);
		const linkedBoxes = boxes.filter((box) => boxIds.includes(box.id));
		if (linkedBoxes.length === 0) {
			return;
		}

		const shouldShow = linkedBoxes.some((box) => !box.visible);
		for (const box of linkedBoxes) {
			box.visible = shouldShow;
			this.touchBox(box);
		}
		this.scheduleSave();
		this.renderAllMarkdownViews();
	}

	private positionPopover(popover: HTMLElement, clientX: number, clientY: number): void {
		popover.style.left = `${clientX}px`;
		popover.style.top = `${clientY}px`;

		const margin = 8;
		const rect = popover.getBoundingClientRect();
		const left = this.clamp(clientX, margin, Math.max(margin, window.innerWidth - rect.width - margin));
		const top = this.clamp(clientY, margin, Math.max(margin, window.innerHeight - rect.height - margin));
		popover.style.left = `${left}px`;
		popover.style.top = `${top}px`;
	}

	private closeContextPopover(): void {
		this.contextPopoverAbort?.abort();
		this.contextPopoverAbort = undefined;
		this.contextPopover?.remove();
		this.contextPopover = undefined;
	}

	private truncate(value: string, maxLength: number): string {
		const compact = value.replace(/\s+/g, ' ').trim();
		return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
	}

	private clamp(value: number, min: number, max: number): number {
		return Math.min(Math.max(value, min), max);
	}

	private removeRenderedLayer(host: HTMLElement): void {
		host.querySelectorAll('.floating-text-overlay__layer').forEach((layer) => {
			const overlayLayer = layer as HTMLElement;
			if (this.activeFloatingEditor && overlayLayer.contains(this.activeFloatingEditor.textarea)) {
				this.deactivateFloatingEditorBridge();
			}
			this.disposeLayerScrollBinding(overlayLayer);
			overlayLayer.remove();
		});
	}

	private removeAllRenderedLayers(): void {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			if (!(leaf.view instanceof MarkdownView)) {
				continue;
			}
			leaf.view.contentEl.classList.remove('floating-text-overlay__host');
			this.removeRenderedLayer(leaf.view.contentEl);
		}
	}
}
