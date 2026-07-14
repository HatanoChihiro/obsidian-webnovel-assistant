import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForeshadowingManager } from '../src/services/ForeshadowingManager';
import { ForeshadowingStatus } from '../src/types/foreshadowing';

describe('ForeshadowingManager', () => {
    let mockApp: any;
    let mockPlugin: any;

    beforeEach(() => {
        mockApp = {
            vault: {
                getAbstractFileByPath: vi.fn(),
                create: vi.fn(),
                process: vi.fn()
            },
            fileManager: {
                renameFile: vi.fn()
            }
        };

        mockPlugin = {
            settings: {
                foreshadowing: {
                    fileName: 'Foreshadowing'
                }
            }
        };
    });

    describe('formatEntry', () => {
        it('should format unresolved entries correctly', () => {
            const manager = new ForeshadowingManager(mockApp, mockPlugin);
            
            const formatted = manager.formatEntry({
                status: ForeshadowingStatus.Pending,
                description: 'Who is the hidden boss?',
                content: 'Some context here',
                sourceFile: 'Chapter 1',
                tags: ['Mystery'],
                createdAt: '2023-01-01 12:00'
            });
            
            expect(formatted).toContain('## Who is the hidden boss?');
            expect(formatted).toContain('> [[Chapter 1]]');
            expect(formatted).toContain('> Some context here');
            expect(formatted).toContain('#Mystery');
        });

        it('should format resolved entries correctly', () => {
            const manager = new ForeshadowingManager(mockApp, mockPlugin);
            
            const formatted = manager.formatEntry({
                status: ForeshadowingStatus.Recovered,
                description: 'Found the sword',
                content: 'Sword is found',
                sourceFile: 'Chapter 5',
                tags: [],
                createdAt: '2023-01-02 12:00'
            });
            
            expect(formatted).toContain('## Found the sword');
            expect(formatted).toContain('**状态**：已回收'); // assuming chinese i18n
        });
    });

    describe('findEntryByDescription', () => {
        it('should accurately find an existing entry by description', () => {
            const manager = new ForeshadowingManager(mockApp, mockPlugin);
            const content = `
## Who is the hidden boss?

> [[Chapter 1]]
> Some context here
            `;

            const match = manager['findEntryByDescription'](content, 'Who is the hidden boss?');
            expect(match.found).toBe(true);
        });

        it('should return found=false if description not found', () => {
            const manager = new ForeshadowingManager(mockApp, mockPlugin);
            const content = `## Entry one`;
            
            const match = manager['findEntryByDescription'](content, 'Missing entry');
            expect(match.found).toBe(false);
        });
    });
});
