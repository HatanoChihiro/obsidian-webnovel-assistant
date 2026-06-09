import type { App} from 'obsidian';
import { Notice, PluginSettingTab, Setting } from 'obsidian';
import type { Plugin } from 'obsidian';
import { isDesktop, getPlatformTier } from '../utils/platform';
import { ObsOverlayServer } from '../services/ObsServer';
import { ChapterSorter } from '../services/ChapterSorter';
import { MobileFloatingStats } from './MobileFloatingStats';
import type { FloatingStickyNote } from './StickyNote';
import type { ThemeScheme } from '../types/settings';
import { VALIDATION_RULES } from '../constants';
import type { WebNovelAssistantPlugin } from '../types/plugin';

/**
 * 插件设置面板
 * 提供所有配置选项的界面
 */
export class AccurateCountSettingTab extends PluginSettingTab {
	plugin: WebNovelAssistantPlugin;
	private activeTab: string = 'general';

	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		super(app, plugin as unknown as Plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('设置').setHeading();

		// 创建选项卡头部
		const navContainer = containerEl.createDiv({ cls: 'webnovel-settings-tabs' });
		const tier = getPlatformTier();
		const allTabs = [
			{ id: 'general', name: '通用' },
			{ id: 'wordcount', name: '字数统计' },
			{ id: 'creative', name: '创作辅助', icon: 'pen-tool' },
			{ id: 'immersive', name: '沉浸模式', icon: 'maximize', desktopOnly: true },
			{ id: 'obs', name: '数据输出', desktopOnly: true }
		];

		const tabs = allTabs.filter(tab => {
			if (tier === 'desktop') return true;
			return !tab.desktopOnly;
		});

		tabs.forEach(tab => {
			const tabEl = navContainer.createDiv({
				cls: `webnovel-tab-item ${this.activeTab === tab.id ? 'is-active' : ''}`,
				text: tab.name
			});
			tabEl.onclick = () => {
				this.activeTab = tab.id;
				this.display();
			};
		});

		// 渲染对应选项卡内容
		if (this.activeTab === 'general') {
			this.displayGeneralSettings(containerEl);
		} else if (this.activeTab === 'wordcount') {
			this.displayWordCountSettings(containerEl);
		} else if (this.activeTab === 'creative') {
			this.displayCreativeSettings(containerEl);
		} else if (this.activeTab === 'immersive') {
			this.displayImmersiveModeSettings(containerEl);
		} else if (this.activeTab === 'obs') {
			this.displayDataSettings(containerEl);
		}
	}

	// ── 通用设置 ──
	private displayGeneralSettings(containerEl: HTMLElement): void {
		// 平台检测提示
		const tier = getPlatformTier();
		if (tier !== 'desktop') {
			const mobileNotice = containerEl.createDiv({
				cls: 'setting-item-description',
				attr: {
					style: 'background: var(--background-secondary); padding: 12px; border-radius: 6px; margin-bottom: 20px; border-left: 3px solid var(--interactive-accent);'
				}
			});
			mobileNotice.createEl('strong', { text: tier === 'mobile' ? '📱 移动端模式' : '📱 平板端模式' });
			mobileNotice.createEl('br');
			mobileNotice.appendText(tier === 'mobile'
				? '部分高级功能(面板、便签、OBS)仅在桌面端可用。'
				: '已启用面板功能。便签和 OBS 仅在桌面端可用。');

			new Setting(containerEl)
				.setName('显示浮动字数统计')
				.setDesc('在屏幕上显示浮动小窗，实时显示字数进度。')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.showMobileFloatingStats)
					.onChange(async (value) => {
						this.plugin.settings.showMobileFloatingStats = value;
						void this.plugin.saveSettings();
						if (value) {
							if (!this.plugin.mobileFloatingStats) this.plugin.mobileFloatingStats = new MobileFloatingStats(this.app, this.plugin);
							this.plugin.mobileFloatingStats.load();
						} else {
							this.plugin.mobileFloatingStats?.unload();
						}
					}));
		}

		new Setting(containerEl).setName('工作区与章节').setHeading();

		new Setting(containerEl)
			.setName('启用创作主页')
			.setDesc('开启后自动在工作区下生成创作主页，关闭后删除主页文件（作品信息不受影响）。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableHomepage)
				.onChange(async (value) => {
					this.plugin.settings.enableHomepage = value;
					await this.plugin.saveSettings();
					if (value) {
						this.plugin.homepageManager?.ensureHomepageExists().catch(err => console.error('主页创建失败:', err));
						this.plugin.homepageManager?.ensureNovelInfoFiles().catch(err => console.error('作品信息创建失败:', err));
					} else {
						this.plugin.homepageManager?.deleteHomepage().catch(err => console.error('主页删除失败:', err));
					}
					this.display();
				}));

		if (this.plugin.settings.enableHomepage) {
			new Setting(containerEl)
				.setName('启动时自动打开主页')
				.setDesc('每次开启 Obsidian 时自动打开创作主页。')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.openHomepageOnStartup)
					.onChange(async (value) => {
						this.plugin.settings.openHomepageOnStartup = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('自定义主页文件名')
				.setDesc('修改创作主页在文件树中的默认名称（无需加 .md 后缀）。留空则恢复默认的"创作主页"。修改后将自动重命名现有主页。')
				.addText(text => {
					const currentPath = this.plugin.homepageManager?.getHomepageFilePath() || '创作主页.md';
					const currentName = currentPath.split('/').pop()?.replace(/\.md$/, '') || '创作主页';
					
					text.setPlaceholder('创作主页')
						.setValue(currentName);
					
					let tempValue = text.getValue();
					text.onChange((value) => { tempValue = value; });
					
					const saveAction = async () => {
						const basename = tempValue.trim() || '创作主页';
						const oldPath = this.plugin.homepageManager?.getHomepageFilePath() || '创作主页.md';
						
						const lastSlash = oldPath.lastIndexOf('/');
						const oldDir = lastSlash >= 0 ? oldPath.substring(0, lastSlash + 1) : '';
						const newPath = oldDir + basename + '.md';

						if (newPath !== oldPath) {
							this.plugin.settings.homepagePath = newPath;
							await this.plugin.saveSettings();
							this.plugin.homepageManager?.renameHomepageFile(oldPath, newPath).catch(console.error);
							new Notice(`主页已重命名为: ${basename}`);
						}
					};

					text.inputEl.addEventListener('change', () => { void saveAction(); });
					// 按回车也可以保存
					text.inputEl.addEventListener('keydown', (e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							text.inputEl.blur();
						}
					});
				});

			new Setting(containerEl)
				.setName('自定义欢迎语')
				.setDesc('显示在创作主页顶部的欢迎语，留空则根据时间动态问候。')
				.addText(text => text
					.setPlaceholder('欢迎回到创作中心')
					.setValue(this.plugin.settings.homepageWelcome || '')
					.onChange(async (value) => {
						this.plugin.settings.homepageWelcome = value.trim();
						await this.plugin.saveSettings();
						this.plugin.homepageManager?.refreshHomepageViews();
					}));

			new Setting(containerEl)
				.setName('主页在文件树中的位置')
				.setDesc('固定创作主页在文件浏览器中的位置，防止新增作品时需要手动拖拽。')
				.addDropdown(dropdown => dropdown
					.addOptions({
						'none': '不固定（由排序规则或拖拽自定义）',
						'top': '固定在最顶部',
						'bottom': '固定在最底部'
					})
					.setValue(this.plugin.settings.homepagePinPosition || 'top')
					.onChange(async (value: string) => {
						this.plugin.settings.homepagePinPosition = value as 'none' | 'top' | 'bottom';
						await this.plugin.saveSettings();
						if (value !== 'none') {
							this.plugin.fileExplorerPatcher.enable();
						}
						// 触发文件树刷新
						this.app.workspace.getLeavesOfType('file-explorer').forEach(leaf => {
							const view = leaf.view as unknown as Record<string, unknown>;
							if (view && typeof view.sort === 'function') {
								try { (view.sort as () => void)(); } catch { /* 内部 API，容错处理 */ }
							}
						});
					}));
		}

		new Setting(containerEl)
			.setName('工作区文件夹')
			.setDesc('留空全局生效。多个用逗号分隔。')
			.addTextArea(text => {
				text.setPlaceholder('例如：小说/第一卷')
					.setValue((this.plugin.settings.workspaceFolders || []).join(', '))
					.onChange(async (value) => {
						this.plugin.settings.workspaceFolders = value.trim() ? value.split(',').map(f => f.trim()).filter(Boolean) : [];
						await this.plugin.saveSettings();
					});
				text.inputEl.addClass('webnovel-settings-input-full');
			});

		new Setting(containerEl)
			.setName('严格章节模式')
			.setDesc('所有涉及字数相关（目标、统计、字数提醒等）的功能均只在符合命名规则的文档中生效。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableStrictChapterMode)
				.onChange(async (value) => {
					this.plugin.settings.enableStrictChapterMode = value;
					await this.plugin.saveSettings();
					this.plugin.updateWordCount();
					if (this.plugin.settings.showExplorerCounts) {
						void this.plugin.buildFolderCache();
					}
					this.display();
				}));
		if (this.plugin.settings.enableStrictChapterMode) {
			new Setting(containerEl)
				.setName('例外目录')
				.setDesc('这些目录下的文件不受严格章节模式限制，始终计入字数。多个目录用逗号分隔。')
				.addTextArea(text => {
					text
						.setPlaceholder('例如：短篇小说, 杂文')
						.setValue((this.plugin.settings.strictChapterExceptions || []).join(', '))
						.onChange(async (value) => {
							this.plugin.settings.strictChapterExceptions = value.trim() ? value.split(',').map(f => f.trim()).filter(Boolean) : [];
							await this.plugin.saveSettings();
							this.plugin.updateWordCount();
							if (this.plugin.settings.showExplorerCounts) {
								void this.plugin.buildFolderCache();
							}
						});
					text.inputEl.addClass('webnovel-settings-input-full');
				});
		}


		new Setting(containerEl)
			.setName('智能章节排序')
			.setDesc('自动识别章节编号进行数字排序。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableSmartChapterSort)
				.onChange(async (value) => {
					this.plugin.settings.enableSmartChapterSort = value;
					await this.plugin.saveSettings();
					if (value) this.plugin.fileExplorerPatcher.enable();
					else this.plugin.fileExplorerPatcher.disable();
					this.display();
				}));

		if (this.plugin.settings.enableSmartChapterSort) {
			this.displaySortingRules(containerEl);
		}

		new Setting(containerEl).setName('护眼模式').setHeading();

		new Setting(containerEl)
			.setName('启用护眼模式')
			.setDesc('将编辑区和阅读区的背景色替换为护眼色，其他界面保持不变。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.eyeCareEnabled ?? false)
				.onChange(async (value) => {
					this.plugin.settings.eyeCareEnabled = value;
					await this.plugin.saveSettings();
					if (value) {
						this.plugin.applyEyeCare();
					} else {
						this.plugin.removeEyeCare();
					}
				}));

		new Setting(containerEl)
			.setName('护眼背景色')
			.setDesc('推荐使用低饱和度的绿色或暖色调，减少视觉疲劳。')
			.addColorPicker(picker => picker
				.setValue(this.plugin.settings.eyeCareColor || '#E8F5E9')
				.onChange(async (value) => {
					this.plugin.settings.eyeCareColor = value;
					await this.plugin.saveSettings();
					if (this.plugin.settings.eyeCareEnabled) {
						this.plugin.applyEyeCare();
					}
				}))
			.addExtraButton(btn => btn
				.setIcon('reset')
				.setTooltip('恢复默认颜色 (#E8F5E9)')
				.onClick(async () => {
					this.plugin.settings.eyeCareColor = '#E8F5E9';
					await this.plugin.saveSettings();
					if (this.plugin.settings.eyeCareEnabled) {
						this.plugin.applyEyeCare();
					}
					this.display();
				}));
	}

	// ── 字数统计设置 ──
	private displayWordCountSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('字数显示').setHeading();

		new Setting(containerEl)
			.setName('字数统计模式')
			.setDesc('选择底层字数统计算法（切换后将自动全库重新计算）。\n网文模式：所有非空白字符均算作1个字（含标点）。\n标准模式：合并英文单词，全角标点算作1个字。\n原生模式：彻底忽略所有标点符号。')
			.addDropdown(drop => drop
				.addOption('webnovel', '网文模式（标点算字）')
				.addOption('standard', '标准模式（英文算词，全角标点算字）')
				.addOption('obsidian', '原生模式（忽略所有标点）')
				.setValue(this.plugin.settings.wordCountMethod)
				.onChange(async (value: string) => {
					this.plugin.settings.wordCountMethod = value as 'webnovel' | 'standard' | 'obsidian';
					await this.plugin.saveSettings();
					new Notice('正在根据新规则全库重算字数...');
					await this.plugin.buildFolderCache();
					this.plugin.updateWordCount();
				}));

		new Setting(containerEl)
			.setName('显示状态栏进度')
			.setDesc('在 Obsidian 底部状态栏显示当前章节进度。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showGoal)
				.onChange(async (value) => {
					this.plugin.settings.showGoal = value;
					await this.plugin.saveSettings();
					this.plugin.updateWordCount();
				}));

		new Setting(containerEl)
			.setName('显示文件列表字数')
			.setDesc('在侧边栏文件树中显示汇总字数。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showExplorerCounts)
				.onChange(async (value) => {
					this.plugin.settings.showExplorerCounts = value;
					await this.plugin.saveSettings();
					if (value) await this.plugin.buildFolderCache();
					else this.plugin.refreshFolderCounts();
				}));

		if (isDesktop()) {
			new Setting(containerEl)
				.setName('字数实时提醒')
				.setDesc('开启后，将在编辑器的左侧行号区域，按照设定的字数间隔实时显示当前行的累计字数。')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.enableWordCountGutter)
					.onChange(async (value) => {
						this.plugin.settings.enableWordCountGutter = value;
						await this.plugin.saveSettings();
						this.app.workspace.trigger('webnovel:word-count-gutter-settings-changed');
					}));

			new Setting(containerEl)
				.setName('字数提醒间隔')
				.setDesc('设置每隔多少字在左侧显示一次提示标签。')
				.addText(text => text
					.setValue((this.plugin.settings.wordCountInterval || 2000).toString())
					.onChange(async (v) => {
						const p = parseInt(v, 10);
						if (!isNaN(p) && p > 0) {
							this.plugin.settings.wordCountInterval = p;
							await this.plugin.saveSettings();
							this.app.workspace.trigger('webnovel:word-count-gutter-settings-changed');
						}
					}));
		}

		new Setting(containerEl).setName('写作目标').setHeading();

		new Setting(containerEl)
			.setName('默认章节目标')
			.setDesc('每个章节的默认目标字数。')
			.addText(text => text.setValue(this.plugin.settings.defaultGoal.toString()).onChange(async (v) => {
				const p = parseInt(v, 10); if (!isNaN(p)) { this.plugin.settings.defaultGoal = p; await this.plugin.saveSettings(); }
			}));

		new Setting(containerEl)
			.setName('今日目标字数')
			.setDesc('今日新增总字数目标。')
			.addText(text => text.setValue((this.plugin.settings.dailyGoal || 5000).toString()).onChange(async (v) => {
				const p = parseInt(v, 10); if (!isNaN(p)) { this.plugin.settings.dailyGoal = p; await this.plugin.saveSettings(); }
			}));
	}

	// ── 创作辅助设置 ──
	private displayCreativeSettings(containerEl: HTMLElement): void {
		const tier = getPlatformTier();
		if (tier === 'desktop') {
			this.displayStickyNoteSettings(containerEl);
		}
		this.displayForeshadowingSettings(containerEl);
		this.displayTimelineSettings(containerEl);
		this.displayRankingSettings(containerEl);
		
		if (tier === 'desktop') {
			this.displayLoreSettings(containerEl);
		}
	}

	// ── 伏笔设置 ──
	private displayRankingSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('榜单追踪').setHeading();

		new Setting(containerEl)
			.setName('榜单记录文件名')
			.setDesc('榜单数据保存到当前文件夹下的此文件中（无需 .md 后缀）。')
			.addText(text => text
				.setPlaceholder('榜单记录')
				.setValue(this.plugin.settings.ranking?.fileName || '榜单记录')
				.onChange(async (value) => {
					const trimmed = value.trim().replace(/\.md$/i, '');
					if (!this.plugin.settings.ranking) {
						this.plugin.settings.ranking = { fileName: '榜单记录' };
					}
					this.plugin.settings.ranking.fileName = trimmed || '榜单记录';
					await this.plugin.saveSettings();
				}));
	}

	// ── 排序规则 ──
	private displaySortingRules(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('排序规则配置')
			.setHeading();

		const rulesContainer = containerEl.createDiv();
		rulesContainer.addClass('webnovel-settings-rules-container');

		const renderRules = () => {
			rulesContainer.empty();
			this.plugin.settings.chapterNamingRules.forEach((rule, index) => {
				const s = new Setting(rulesContainer);
s.settingEl.addClass('webnovel-settings-rule-item');

				s.infoEl.remove();

				const rules = this.plugin.settings.chapterNamingRules;
				const orderBtns = s.settingEl.createDiv({ attr: { style: 'display:flex;flex-direction:column;gap:2px;flex-shrink:0;' } });
				const upBtn = orderBtns.createEl('button', { text: '▲', attr: { title: '上移', style: 'font-size:10px;padding:1px 5px;cursor:pointer;line-height:1.2;' } });
				const downBtn = orderBtns.createEl('button', { text: '▼', attr: { title: '下移', style: 'font-size:10px;padding:1px 5px;cursor:pointer;line-height:1.2;' } });
				if (index === 0) upBtn.disabled = true;
				if (index === rules.length - 1) downBtn.disabled = true;
				upBtn.onclick = async () => {
					[rules[index - 1], rules[index]] = [rules[index], rules[index - 1]];
					await this.plugin.saveSettings();
					ChapterSorter.setCustomRules(rules);
					this.plugin.fileExplorerPatcher.refreshManually();
					renderRules();
				};
				downBtn.onclick = async () => {
					[rules[index + 1], rules[index]] = [rules[index], rules[index + 1]];
					await this.plugin.saveSettings();
					ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules);
					this.plugin.fileExplorerPatcher.refreshManually();
					renderRules();
				};

				s.addToggle(chk => chk
					.setValue(rule.enabled)
					.onChange(async (value) => {
						rule.enabled = value;
						await this.plugin.saveSettings();
						ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules);
						this.plugin.fileExplorerPatcher.refreshManually();
					}));

				s.addText(text => {
					text.setValue(rule.name)
						.setPlaceholder('名称')
						.onChange(async (value) => {
							rule.name = value;
							await this.plugin.saveSettings();
						});
					text.inputEl.addClass('webnovel-rule-name-input');
				});

				s.addText(text => {
					text.setValue(rule.pattern)
						.setPlaceholder('正则表达式')
						.onChange(async (value) => {
							// [安全] ReDoS 防护：长度限制
							if (value.length > 200) {
								new Notice('⚠️ 正则表达式过长（>200字符），请简化模式');
								return;
							}

							// [安全] ReDoS 防护：禁止嵌套量词（如 (a+)+、(a*)*）
							if (/([+*])\)?[+*]/.test(value)) {
								new Notice('⚠️ 检测到嵌套量词模式，可能导致灾难性回溯（ReDoS）');
								return;
							}

							// [安全] 语法校验
							try {
								new RegExp(value, 'i');
							} catch {
								new Notice('⚠️ 正则表达式语法无效');
								return;
							}

							rule.pattern = value;
							await this.plugin.saveSettings();
							ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules);
							this.plugin.fileExplorerPatcher.refreshManually();
						});
					text.inputEl.addClass('webnovel-rule-pattern-input');
				});

				s.addButton(btn => btn
					.setButtonText('删除')
					.setWarning()
					.onClick(async () => {
						this.plugin.settings.chapterNamingRules.splice(index, 1);
						await this.plugin.saveSettings();
						ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules);
						this.plugin.fileExplorerPatcher.refreshManually();
						renderRules();
					}));
			});

			const addBtnRow = new Setting(rulesContainer);
			addBtnRow.infoEl.remove();
			addBtnRow.settingEl.addClass('webnovel-add-btn-row');
			addBtnRow.addButton(btn => btn
				.setButtonText('+ 添加新规则')
				.onClick(async () => {
					this.plugin.settings.chapterNamingRules.push({ name: '新规则', pattern: '^(\\d+)', enabled: true });
					await this.plugin.saveSettings();
					renderRules();
				}).buttonEl.addClass('webnovel-settings-btn-full'));
		};
		renderRules();
	}

	// ── 悬浮便签设置 ──
	private displayStickyNoteSettings(containerEl: HTMLElement): void {
		if (!isDesktop()) return;

		new Setting(containerEl).setName('悬浮便签').setHeading();

		new Setting(containerEl)
			.setName('闲置透明度')
			.addSlider(slider => slider.setLimits(0.1, 1, 0.05).setValue(this.plugin.settings.noteOpacity).onChange(async (v) => {
				this.plugin.settings.noteOpacity = v; await this.plugin.saveSettings();
				this.plugin.activeNotes.forEach((n: FloatingStickyNote) => n.updateVisuals());
			}));

		new Setting(containerEl)
			.setName('便签自动保存')
			.setDesc('开启后，在便签中输入内容会实时保存到内存和文件；关闭后，仅在关闭便签时提示手动保存。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.stickyNoteAutoSave)
				.onChange(async (value) => {
					this.plugin.settings.stickyNoteAutoSave = value;
					await this.plugin.saveSettings();
				}));

		const colorSetting = new Setting(containerEl).setName('主题色方案').setDesc('自定义 6 种预设配色。');
		const colorContainer = colorSetting.controlEl.createDiv({ attr: { style: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;' } });

		this.plugin.settings.noteThemes.forEach((theme: ThemeScheme, index: number) => {
			const themeDiv = colorContainer.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 4px; background: var(--background-modifier-form-field); padding: 4px; border-radius: 4px;' } });
			const bg = themeDiv.createEl('input', { type: 'color', value: theme.bg });
			const txt = themeDiv.createEl('input', { type: 'color', value: theme.text });
			bg.onchange = async (e) => { this.plugin.settings.noteThemes[index].bg = (e.target as HTMLInputElement).value; await this.plugin.saveSettings(); };
			txt.onchange = async (e) => { this.plugin.settings.noteThemes[index].text = (e.target as HTMLInputElement).value; await this.plugin.saveSettings(); };
		});
	}

	// ── 沉浸模式设置 ──
	private displayImmersiveLayoutBuilder(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('自定义沉浸模式布局')
			.setDesc('通过下拉菜单自由分配主编辑区四周的辅助面板。如果某侧无分配组件，主编辑区将自动向该侧贴边。')
			.setHeading();

		const builderContainer = containerEl.createDiv('wn-layout-builder-container');
		this.renderLayoutBuilder(builderContainer);
	}

	private getAvailableViews(): Record<string, string> {
		return {
			'immersive-chapter-list-view': '章节列表',
			'immersive-sticky-notes-view': '悬浮便签',
			'foreshadowing-view': '伏笔面板',
			'timeline-view': '时间线面板',
			'reference-view': '参考文档',
			'webnovel-corkboard': '章节一览'
		};
	}

	private getViewName(id: string): string {
		return this.getAvailableViews()[id] || id;
	}

	private renderLayoutBuilder(container: HTMLElement): void {
		container.empty();
		const immersive = this.plugin.settings.immersive;

		const createSlotEditor = (parent: HTMLElement, title: string, key: 'immersiveTopSlots'|'immersiveBottomSlots'|'immersiveLeftSlots'|'immersiveRightSlots') => {
			const wrapper = parent.createDiv('wn-slot-editor');
			wrapper.createEl('strong', { text: title, cls: 'wn-slot-title' });
			
			const list = wrapper.createDiv('wn-slot-list');
			const slots = immersive[key] || [];
			
			if (slots.length === 0) {
				list.createSpan({ text: '（空置，自动贴边）', cls: 'wn-slot-empty' });
			}
			
			for (let i = 0; i < slots.length; i++) {
				const item = list.createDiv('wn-slot-item');
				item.createSpan({ text: this.getViewName(slots[i]) });
				const delBtn = item.createEl('button', { text: '✕', cls: 'wn-slot-del' });
				delBtn.onclick = async () => {
					slots.splice(i, 1);
					await this.plugin.saveSettings();
					this.renderLayoutBuilder(container);
				};
			}

			const select = wrapper.createEl('select', { cls: 'dropdown' });
			select.createEl('option', { text: '+ 添加组件', value: '' });
			for (const [id, name] of Object.entries(this.getAvailableViews())) {
				select.createEl('option', { text: name, value: id });
			}
			select.onchange = async () => {
				if (select.value) {
					if (!immersive[key]) immersive[key] = [];
					immersive[key].push(select.value);
					await this.plugin.saveSettings();
					this.renderLayoutBuilder(container);
				}
			};
		};

		const grid = container.createDiv('wn-layout-grid');
		
		const topArea = grid.createDiv('wn-layout-top');
		createSlotEditor(topArea, '上方 (Top)', 'immersiveTopSlots');

		const middleArea = grid.createDiv('wn-layout-middle');
		
		const leftArea = middleArea.createDiv('wn-layout-left');
		createSlotEditor(leftArea, '左侧 (Left)', 'immersiveLeftSlots');
		
		const centerArea = middleArea.createDiv('wn-layout-center');
		centerArea.createDiv({ text: '主编辑区', cls: 'wn-layout-center-text' });
		
		const rightArea = middleArea.createDiv('wn-layout-right');
		createSlotEditor(rightArea, '右侧 (Right)', 'immersiveRightSlots');

		const bottomArea = grid.createDiv('wn-layout-bottom');
		createSlotEditor(bottomArea, '下方 (Bottom)', 'immersiveBottomSlots');
	}

	private displayImmersiveModeSettings(containerEl: HTMLElement): void {
		this.displayImmersiveLayoutBuilder(containerEl);

		new Setting(containerEl)
			.setName('自动隐藏笔记属性 (Properties)')
			.setDesc('在沉浸模式下自动隐藏 Markdown 文件顶部的属性面板区域。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersive.immersiveHideProperties)
				.onChange(async (value) => {
					this.plugin.settings.immersive.immersiveHideProperties = value;
					await this.plugin.saveSettings();
					
					// 如果当前处于沉浸模式则立即生效
					if (activeDocument.body.classList.contains('immersive-mode-active')) {
						if (value) activeDocument.body.classList.add('immersive-hide-properties');
						else activeDocument.body.classList.remove('immersive-hide-properties');
					}
				}));

		new Setting(containerEl).setName('沉浸模式便签设置').setHeading();

		new Setting(containerEl)
			.setName('便签显示尺寸 (px)')
			.setDesc('沉浸模式下便签的正方形边长。')
			.addSlider(slider => slider
				.setLimits(150, 600, 10)
				.setValue(this.plugin.settings.immersive.immersiveNoteSize || 280)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.immersive.immersiveNoteSize = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('便签字体大小 (px)')
			.setDesc('沉浸模式下便签文本框内的字体大小。')
			.addSlider(slider => slider
				.setLimits(10, 30, 1)
				.setValue(this.plugin.settings.immersive.immersiveNoteFontSize || 14)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.immersive.immersiveNoteFontSize = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl).setName('顶部仪表盘数据开关').setHeading();

		new Setting(containerEl)
			.setName('显示总计时间')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersive.immersiveShowTotalTime)
				.onChange(async (value) => {
					this.plugin.settings.immersive.immersiveShowTotalTime = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('显示专注时间')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersive.immersiveShowFocusTime)
				.onChange(async (value) => {
					this.plugin.settings.immersive.immersiveShowFocusTime = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('显示摸鱼时间')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersive.immersiveShowSlackTime)
				.onChange(async (value) => {
					this.plugin.settings.immersive.immersiveShowSlackTime = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('显示章节目标进度')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersive.immersiveShowChapterProgress)
				.onChange(async (value) => {
					this.plugin.settings.immersive.immersiveShowChapterProgress = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('显示今日目标进度')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersive.immersiveShowDailyProgress)
				.onChange(async (value) => {
					this.plugin.settings.immersive.immersiveShowDailyProgress = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('显示榜单目标进度')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersive.immersiveShowRankingProgress)
				.onChange(async (value) => {
					this.plugin.settings.immersive.immersiveShowRankingProgress = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('显示本场净增')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersive.immersiveShowSessionWords)
				.onChange(async (value) => {
					this.plugin.settings.immersive.immersiveShowSessionWords = value;
					await this.plugin.saveSettings();
				}));
	}
	// ── 伏笔标注设置 ──
	private displayForeshadowingSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('伏笔标注').setHeading();

		new Setting(containerEl)
			.setName('伏笔文件名')
			.setDesc('标注的伏笔将保存到当前文件夹下的此文件中（无需 .md 后缀）。')
			.addText(text => text
				.setPlaceholder('伏笔')
				.setValue(this.plugin.settings.foreshadowing?.fileName || '伏笔')
				.onChange(async (value) => {
					const trimmed = value.trim().replace(/\.md$/i, '');
					if (!this.plugin.settings.foreshadowing) {
						this.plugin.settings.foreshadowing = { fileName: '伏笔', showTimestamp: true, defaultTags: [] };
					}
					this.plugin.settings.foreshadowing.fileName = trimmed || '伏笔';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('显示时间戳')
			.setDesc('在伏笔条目标题中显示标注时间。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.foreshadowing?.showTimestamp !== false)
				.onChange(async (value) => {
					if (!this.plugin.settings.foreshadowing) {
						this.plugin.settings.foreshadowing = { fileName: '伏笔', showTimestamp: true, defaultTags: [] };
					}
					this.plugin.settings.foreshadowing.showTimestamp = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('常用标签')
			.setDesc('用空格分隔，标注伏笔时可快速点击添加。')
			.addText(text => {
				const tags = this.plugin.settings.foreshadowing?.defaultTags || [];
				text
					.setPlaceholder('人物 情节 世界观 道具 伏线')
					.setValue(tags.join(' '))
					.onChange(async (value) => {
						if (!this.plugin.settings.foreshadowing) {
							this.plugin.settings.foreshadowing = { fileName: '伏笔', showTimestamp: true, defaultTags: [] };
						}
						this.plugin.settings.foreshadowing.defaultTags = value.trim()
							? value.trim().split(/\s+/).filter(Boolean)
							: [];
						await this.plugin.saveSettings();
					});
				text.inputEl.addClass('webnovel-settings-input-full');
			});
	}

	// ── 设定速查设置 ──
	private displayLoreSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('设定速查').setHeading();

		const desc = activeDocument.createDocumentFragment();
		desc.append(
			'指定每部作品下存放设定的文件夹名称。',
			desc.createEl('br'),
			desc.createEl('strong', { text: '提示：' }),
			'该文件夹下的所有文档都将被扫描解析。插件会自动提取文档内的标题（## 正名）和正文中的别名（**别名**：xxx）。在小说正文敲出这些名字时，即可自动产生下划线并支持精准悬浮卡片。'
		);

		new Setting(containerEl)
			.setName('设定文件夹名称')
			.setDesc(desc)
			.addText(text => text
				.setPlaceholder('默认: 设定')
				.setValue(this.plugin.settings.loreFolderName)
				.onChange(async (value: string) => {
					this.plugin.settings.loreFolderName = value.trim() || '设定';
					await this.plugin.saveSettings();
				}));
	}

	// ── 时间线设置 ──
	private displayTimelineSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('时间线').setHeading();

		new Setting(containerEl)
			.setName('时间线文件名')
			.setDesc('时间线数据保存到当前文件夹下的此文件中（无需 .md 后缀）。')
			.addText(text => text
				.setPlaceholder('时间线')
				.setValue(this.plugin.settings.timeline?.fileName || '时间线')
				.onChange(async (value) => {
					const trimmed = value.trim().replace(/\.md$/i, '');
					if (!this.plugin.settings.timeline) {
						this.plugin.settings.timeline = { fileName: '时间线', defaultTypes: [] };
					}
					this.plugin.settings.timeline.fileName = trimmed || '时间线';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('常用类型')
			.setDesc('用空格分隔，添加时间线事件时可从下拉列表选择。')
			.addText(text => {
				const types = this.plugin.settings.timeline?.defaultTypes || [];
				text
					.setPlaceholder('主线 支线 伏笔 世界观 人物')
					.setValue(types.join(' '))
					.onChange(async (value) => {
						if (!this.plugin.settings.timeline) {
							this.plugin.settings.timeline = { fileName: '时间线', defaultTypes: [] };
						}
						this.plugin.settings.timeline.defaultTypes = value.trim()
							? value.trim().split(/\s+/).filter(Boolean)
							: [];
						await this.plugin.saveSettings();
					});
				text.inputEl.addClass('webnovel-settings-input-full');
			});
	}

	// ── 数据输出设置 ──
	private displayDataSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('专注度判定').setHeading();

		new Setting(containerEl)
			.setName('精准专注度判定阈值 (秒)')
			.setDesc('在此时间内没有键盘输入，即使软件处于聚焦状态，也会被判定为"摸鱼"。')
			.addSlider(slider => slider
				.setLimits(30, 600, 30)
				.setValue(this.plugin.settings.idleTimeoutThreshold / 1000)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.idleTimeoutThreshold = value * 1000;
					await this.plugin.saveSettings();
				}));

		this.displayObsSettings(containerEl);
	}

	private displayObsSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('OBS 数据叠加层').setHeading();

		new Setting(containerEl)
			.setName('启用数据叠加层 (OBS/直播)')
			.setDesc('在本地启动 HTTP 服务，OBS 通过「浏览器源」加载实时统计面板，零磁盘 I/O。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.obs.enableObs)
				.onChange(async (value) => {
					this.plugin.settings.obs.enableObs = value;
					await this.plugin.saveSettings();
					if (value) {
						if (this.plugin.obsServer) {
							await this.plugin.obsServer.stop();
						}
						this.plugin.obsServer = new ObsOverlayServer(this.plugin, this.plugin.settings.obs.obsPort);
						this.plugin.obsServer.start();
					} else {
						await this.plugin.obsServer?.stop();
						this.plugin.obsServer = null;
					}
				}));

		new Setting(containerEl)
			.setName('叠加层端口')
			.setDesc('OBS 浏览器源访问的端口号，修改后需重启叠加层。')
			.addText(text => text
				.setValue(this.plugin.settings.obs.obsPort.toString())
				.onChange(async (value) => {
					const parsed = parseInt(value, 10);
					if (parsed >= VALIDATION_RULES.PORT_RANGE.min &&
						parsed <= VALIDATION_RULES.PORT_RANGE.max) {
						this.plugin.settings.obs.obsPort = parsed;
						await this.plugin.saveSettings();

						if (this.plugin.settings.obs.enableObs && this.plugin.obsServer) {
							await this.plugin.obsServer.stop();
							this.plugin.obsServer = new ObsOverlayServer(this.plugin, this.plugin.settings.obs.obsPort);
							this.plugin.obsServer.start();
							new Notice(`OBS 叠加层已重启，新端口：${parsed}`);
						}
					} else if (!isNaN(parsed)) {
						new Notice(`端口号必须在 ${VALIDATION_RULES.PORT_RANGE.min}-${VALIDATION_RULES.PORT_RANGE.max} 之间`);
					}
				}));

		new Setting(containerEl)
			.setName('叠加层背景透明度')
			.setDesc('调整 OBS 叠加层卡片背景的透明度 (0为完全透明)。')
			.addSlider(slider => slider
				.setLimits(0, 1, 0.05)
				.setValue(this.plugin.settings.obs.obsOverlayOpacity ?? 0.85)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.obs.obsOverlayOpacity = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('自定义 CSS')
			.setDesc('通过覆盖 CSS 类名修改样式')
			.addTextArea(text => {
				text.setPlaceholder('/* 例：修改摸鱼时间为绿色 */ .time-value.slack { color: #4CAF50 !important; }')
					.setValue(this.plugin.settings.obs.obsCustomCss)
					.onChange(async (value) => {
						this.plugin.settings.obs.obsCustomCss = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.addClass('webnovel-obs-css-input');
				return text;
			});

		new Setting(containerEl)
			.setName('叠加层主题')
			.addDropdown(dropdown => {
				dropdown.addOption('dark', '暗色 (深色背景+白字)');
				dropdown.addOption('light', '亮色 (浅色背景+深字)');
				this.plugin.settings.noteThemes.forEach((theme: ThemeScheme, index: number) => {
					dropdown.addOption(`note-${index}`, `便签预设色 ${index + 1}`);
				});
				dropdown.setValue(this.plugin.settings.obs.obsOverlayTheme);
				dropdown.onChange(async (value) => {
					this.plugin.settings.obs.obsOverlayTheme = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('显示总计时间')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.obs.obsShowTotalTime).onChange(async (v) => {
				this.plugin.settings.obs.obsShowTotalTime = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName('显示专注时间')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.obs.obsShowFocusTime).onChange(async (v) => {
				this.plugin.settings.obs.obsShowFocusTime = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName('显示摸鱼时间')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.obs.obsShowSlackTime).onChange(async (v) => {
				this.plugin.settings.obs.obsShowSlackTime = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName('显示今日目标进度')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.obs.obsShowDailyGoal ?? true).onChange(async (v) => {
				this.plugin.settings.obs.obsShowDailyGoal = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName('显示章节目标进度')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.obs.obsShowTodayWords).onChange(async (v) => {
				this.plugin.settings.obs.obsShowTodayWords = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName('显示本场净增')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.obs.obsShowSessionWords).onChange(async (v) => {
				this.plugin.settings.obs.obsShowSessionWords = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName('复制数据叠加层 URL')
			.setDesc('点击后复制 URL，在 OBS 中添加「浏览器源」并粘贴此 URL。')
			.addButton(btn => btn
				.setButtonText('复制 URL')
				.onClick(() => {
					const url = `http://127.0.0.1:${this.plugin.settings.obs.obsPort}/`;
					void navigator.clipboard.writeText(url);
					new Notice(`已复制: ${url}`);
				}));
	}
}