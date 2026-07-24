import { type App, TFile, Notice } from 'obsidian';
import type { WebNovelAssistantPlugin } from '../../types/plugin';
import { SaveStickyNoteModal, ConfirmCloseModal } from '../StickyNote';
import { t } from '../../i18n';

export interface StickyNoteBoardRendererOptions {
    app: App;
    plugin: WebNovelAssistantPlugin;
    container: HTMLElement;
    reloadBoard: () => void;
}

export class StickyNoteBoardRenderer {
    static async render(options: StickyNoteBoardRendererOptions): Promise<void> {
        const { app, plugin, container, reloadBoard } = options;

        const notes = plugin.stickyNoteManager.getNotes();

        if (notes.length === 0) {
            container.createDiv({ cls: 'wn-corkboard-empty-msg', text: t('immersive.no-notes-hint') });
            return;
        }

        const dockContainer: HTMLDivElement = container.createDiv({ cls: 'wn-corkboard-grid' });
        const lastSavedContents = new Map<string, string>();

        for (const noteData of notes) {
            if (!lastSavedContents.has(noteData.id)) {
                lastSavedContents.set(noteData.id, noteData.content || '');
            }

            const noteCard = dockContainer.createDiv({ cls: 'wn-corkboard-card immersive-sticky-card' });
            noteCard.dataset.noteId = noteData.id;
            noteCard.setCssStyles({ backgroundColor: noteData.color || '#FDF3B8' });
            noteCard.addClass('webnovel-immersive-note-card');
            if (noteData.textColor) {
                noteCard.setCssProps({ color: noteData.textColor });
            }

            const titleEl = noteCard.createDiv({ cls: 'immersive-sticky-title' });
            titleEl.addClass('webnovel-immersive-note-title');
            const titleSpan = titleEl.createSpan();
            titleSpan.setText(noteData.title || t('immersive.note-default-title'));
            titleSpan.addClass('webnovel-ellipsis');

            const closeBtn = titleEl.createSpan({ cls: 'clickable-icon', text: '×' });
            closeBtn.addClass('webnovel-immersive-note-close');
            closeBtn.title = t('immersive.close-note-tooltip');

            const performRemove = async () => {
                plugin.stickyNoteManager.removeNote(noteData.id);
                lastSavedContents.delete(noteData.id);
                await plugin.stickyNoteManager.saveNotes(plugin.stickyNoteManager.getNotes());
                reloadBoard();
            };

            closeBtn.onclick = () => {
                const latestNote = plugin.stickyNoteManager.getNotes().find(n => n.id === noteData.id) || noteData;
                const currentContent = latestNote.content || '';
                const lastSaved = lastSavedContents.get(latestNote.id) || '';
                const hasContent = currentContent.trim().length > 0;
                const hasUnsavedChanges = currentContent !== lastSaved;

                // 统一未保存便签关闭提示逻辑：未关联文件且有内容，或已关联文件且内容未同步
                const shouldPrompt = (!latestNote.filePath && hasContent) || (latestNote.filePath && hasUnsavedChanges);

                if (shouldPrompt) {
                    const modal = new ConfirmCloseModal(app, (shouldSave: boolean) => {
                        if (shouldSave) {
                            if (latestNote.filePath) {
                                const file = app.vault.getAbstractFileByPath(latestNote.filePath);
                                if (file instanceof TFile) {
                                    void app.vault.process(file, () => currentContent);
                                    new Notice(t('modal.note-saved'));
                                }
                                void performRemove();
                            } else {
                                const saveModal = new SaveStickyNoteModal(app, plugin, (fileName: string, folderPath: string) => {
                                    try {
                                        const fullPath = (folderPath ? `${folderPath}/` : '') + (fileName.endsWith('.md') ? fileName : `${fileName}.md`);
                                        if (app.vault.getAbstractFileByPath(fullPath)) {
                                            new Notice(t('modal.file-already-exists', { path: fullPath }));
                                            return;
                                        }
                                        void app.vault.create(fullPath, currentContent);
                                        new Notice(t('modal.saved-as', { path: fullPath }));
                                        void performRemove();
                                    } catch (error) {
                                        new Notice(t('modal.save-failed', { error: String(error) }));
                                    }
                                });
                                saveModal.open();
                            }
                        } else {
                            void performRemove();
                        }
                    });
                    modal.open();
                } else {
                    void performRemove();
                }
            };

            const textarea = noteCard.createEl('textarea');
            let displayContent = noteData.content || '';
            let frontmatter = '';
            const fmMatch = displayContent.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
            if (fmMatch) {
                frontmatter = fmMatch[0];
                displayContent = displayContent.substring(frontmatter.length);
            }

            textarea.value = displayContent;
            textarea.addClass('webnovel-immersive-note-textarea');

            textarea.addEventListener('input', () => {
                const latestNote = plugin.stickyNoteManager.getNotes().find(n => n.id === noteData.id) || noteData;
                latestNote.content = frontmatter + textarea.value;

                // 实时更新内存与桌面端悬浮便签（确保包含最新颜色属性）
                plugin.stickyNoteManager.updateNote(latestNote, true);

                if (plugin.settings.stickyNoteAutoSave) {
                    const debounceKey = `immersive-save-note-${latestNote.id}`;
                    plugin.adaptiveDebounceManager.debounceFixed(debounceKey, () => {
                        void plugin.stickyNoteManager.saveNotes(plugin.stickyNoteManager.getNotes());
                        lastSavedContents.set(latestNote.id, latestNote.content || '');

                        if (latestNote.filePath) {
                            const file = app.vault.getAbstractFileByPath(latestNote.filePath);
                            if (file instanceof TFile) {
                                void app.vault.process(file, () => latestNote.content || '');
                            }
                        }
                    }, 500);
                }
            });
        }
    }
}
