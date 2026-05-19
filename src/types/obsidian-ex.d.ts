import 'obsidian';

declare module 'obsidian' {
    interface App {
        plugins: {
            enabledPlugins: Set<string>;
            plugins: {
                [id: string]: any;
            };
        };
        commands: {
            executeCommandById(id: string): boolean;
        };
    }

    interface Workspace {
        getLayout(): any;
        setLayout(layout: any): Promise<void>;
        requestSaveLayout(): void;
        iterateRootLeaves(callback: (leaf: WorkspaceLeaf) => void): void;
        createLeafBySplit(leaf: WorkspaceLeaf, direction: 'horizontal' | 'vertical', before: boolean): WorkspaceLeaf;
        rightSplit?: WorkspaceSplit;

        // 插件自定义事件
        on(name: 'webnovel:notes-changed', callback: () => void): EventRef;
        on(name: 'webnovel:word-count-gutter-settings-changed', callback: () => void): EventRef;
        trigger(name: 'webnovel:notes-changed'): void;
        trigger(name: 'webnovel:word-count-gutter-settings-changed'): void;

        // 内部 API
        detachLeaf(leaf: WorkspaceLeaf): void;
    }

    interface WorkspaceSplit {
        expand(): void;
    }

    interface WorkspaceLeaf {
        id: string;
        active: boolean;
        parent: any;
        containerEl: HTMLElement;
    }

    interface DataAdapter {
        exists(path: string): Promise<boolean>;
        read(path: string): Promise<string>;
        write(path: string, data: string): Promise<void>;
        mkdir(path: string): Promise<void>;
    }

    interface View {
        fileItems?: Record<string, any>;
        refresh?(): void;
        sort?(): void;
        renderNotes?(): void;
        editor?: Editor;
    }

    interface Editor {
        refresh(): void;
    }

    interface MetadataCache {
        on(name: 'changed', callback: (file: TFile) => any, ctx?: any): EventRef;
    }
}

declare global {
    interface Window {
        require(module: 'fs'): any;
        require(module: 'path'): any;
    }
}