import type { EventRef, TFile, TFolder, TAbstractFile } from 'obsidian';
import 'obsidian';
import type { EditorView } from '@codemirror/view';

declare module 'obsidian' {
    interface App {
        plugins: {
            enabledPlugins: Set<string>;
            plugins: {
                [id: string]: unknown;
            };
        };
        commands: {
            executeCommandById(id: string): boolean;
        };
    }

    interface Workspace {
        getLayout(): unknown;
        setLayout(layout: unknown): Promise<void>;
        requestSaveLayout(): void;
        iterateRootLeaves(callback: (leaf: WorkspaceLeaf) => void): void;
        createLeafBySplit(leaf: WorkspaceLeaf, direction: 'horizontal' | 'vertical', before: boolean): WorkspaceLeaf;
        rightSplit?: WorkspaceSplit;

        // 插件自定义事件
        on(name: 'webnovel:notes-changed', callback: () => void): EventRef;
        on(name: 'webnovel:word-count-gutter-settings-changed', callback: () => void): EventRef;
		on(name: 'webnovel:editor-word-count-updated', callback: (file: TAbstractFile, delta: number) => void): EventRef;
        on(name: 'webnovel-workbench-book-changed', callback: (bookPath: string) => void): EventRef;
        on(name: 'webnovel-workbench-lore-updated', callback: () => void): EventRef;
        on(name: 'webnovel-lore-hover-rebuild', callback: () => void): EventRef;
        on(name: 'timeline-filter-changed', callback: (filter: string) => void): EventRef;
        on(name: 'foreshadowing-filter-changed', callback: (filterTag: string) => void): EventRef;
        
        trigger(name: 'webnovel:notes-changed'): void;
        trigger(name: 'webnovel:word-count-gutter-settings-changed'): void;
		trigger(name: 'webnovel:editor-word-count-updated', file: TAbstractFile, delta: number): void;
        trigger(name: 'webnovel-workbench-book-changed', bookPath: string): void;
        trigger(name: 'webnovel-workbench-lore-updated'): void;
        trigger(name: 'webnovel-lore-hover-rebuild'): void;
        trigger(name: 'timeline-filter-changed', filter: string): void;
        trigger(name: 'foreshadowing-filter-changed', filterTag: string): void;
    }

    interface WorkspaceSplit {
        expand(): void;
        type: string;
        direction?: 'horizontal' | 'vertical';
        children: WorkspaceItem[];
        containerEl?: HTMLElement;
        parent?: WorkspaceSplit;
        setElSize?(el: HTMLElement, size: number): void;
    }
    
    interface WorkspaceItem {
        type: string;
        size?: number;
        containerEl?: HTMLElement;
    }

    interface WorkspaceLeaf {
        id: string;
        active: boolean;
        parent: WorkspaceSplit;
        containerEl: HTMLElement;
    }

    interface DataAdapter {
        exists(path: string): Promise<boolean>;
        read(path: string): Promise<string>;
        write(path: string, data: string): Promise<void>;
        mkdir(path: string): Promise<void>;
        fs?: { writeFileSync(path: string, data: string): void };
        getBasePath?(): string;
        path?: { join(...paths: string[]): string };
    }

    interface View {
        fileItems?: Record<string, FileExplorerItem>;
        refresh?(): void | Promise<void>;
        sort?(): void;
        renderNotes?(): void;
        editor?: Editor;
    }

    interface MarkdownView extends View {
        file: TFile;
        editor: Editor;
    }

    interface Editor {
        refresh(): void;
        cm?: EditorView;
    }

    interface Vault {
        getConfig(key: string): unknown;
    }

    interface MetadataCache {
        on(name: 'changed', callback: (file: TFile) => void, ctx?: unknown): EventRef;
    }

    export interface FileExplorerView extends View {
        fileItems: Record<string, FileExplorerItem>;
        getSortedFolderItems(folder: TFolder, bypass?: boolean): FileExplorerItem[];
    }

    export interface FileExplorerItem {
        file: TFile | TFolder;
        el: HTMLElement;
        titleEl: HTMLElement;
        titleInnerEl: HTMLElement;
        selfEl: HTMLElement;
        innerEl: HTMLElement;
        collapsed: boolean;
        children?: FileExplorerItem[];
        setCollapsed(collapsed: boolean): Promise<void>;
    }
}

declare global {
    interface Window {
        require(module: 'fs'): unknown;
        require(module: 'path'): unknown;
        require(module: 'http'): unknown;
    }
}
