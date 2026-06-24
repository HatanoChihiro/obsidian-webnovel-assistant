import type { App } from 'obsidian';
import { PluginSettingTab, Setting, Notice, getLanguage } from 'obsidian';
import type { Plugin } from 'obsidian';
import { isDesktop, getPlatformTier } from '../utils/platform';
import { ObsOverlayServer } from '../services/ObsServer';
import { ChapterSorter } from '../services/ChapterSorter';
import { MobileFloatingStats } from './MobileFloatingStats';
import type { FloatingStickyNote } from './StickyNote';
import type { ThemeScheme } from '../types/settings';
import { VALIDATION_RULES } from '../constants';
import type { WebNovelAssistantPlugin } from '../types/plugin';
import { t, setLocale, detectLocale, type Locale } from '../i18n';
import { getDefaultFileName } from '../i18n/data-keys';

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


		// Add GitHub link box
		const githubBox = containerEl.createDiv({
			cls: 'wn-settings-banner'
		});
		const isZh = this.plugin.settings.language === 'zh-CN' || (this.plugin.settings.language === 'auto' && getLanguage().startsWith('zh'));
		const prefixText = isZh ? '详情及用户指南见 Github：' : 'See details and user guide on Github: ';
		githubBox.createSpan({ text: prefixText, cls: 'text-muted' });
		githubBox.createEl('a', {
			text: 'HatanoChihiro/obsidian-webnovel-assistant',
			href: 'https://github.com/HatanoChihiro/obsidian-webnovel-assistant/releases',
			cls: 'wn-github-link'
		});

		// 创建选项卡头部
		const navContainer = containerEl.createDiv({ cls: 'webnovel-settings-tabs' });
		const tier = getPlatformTier();
		const allTabs = [
			{ id: 'general', name: t('setting.tab-general') },
			{ id: 'wordcount', name: t('setting.tab-wordcount') },
			{ id: 'creative', name: t('setting.tab-creative'), icon: 'pen-tool' },
			{ id: 'immersive', name: t('setting.tab-immersive'), icon: 'maximize', desktopOnly: true },
			{ id: 'obs', name: t('setting.tab-obs'), desktopOnly: true }
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
				cls: 'setting-item-description wn-settings-warning'
			});
			mobileNotice.createEl('strong', { text: tier === 'mobile' ? t('setting.mobile-mode') : t('setting.tablet-mode') });
			mobileNotice.createEl('br');
			mobileNotice.appendText(tier === 'mobile'
				? t('setting.mobile-notice')
				: t('setting.tablet-notice'));

			new Setting(containerEl)
				.setName(t('setting.show-floating-stats'))
				.setDesc(t('setting.show-floating-stats-desc'))
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

		// 语言切换
		new Setting(containerEl).setName(t('setting.language')).setDesc(t('setting.language-desc'))
			.addDropdown(dropdown => {
				dropdown.addOption('zh-CN', '中文 (Chinese)');
				dropdown.addOption('en', 'English');
				dropdown.addOption('auto', t('setting.language-auto'));
				dropdown.setValue(this.plugin.settings.language || 'auto');
				dropdown.onChange(async (value: string) => {
					const locale = value === 'auto' ? detectLocale() : value as Locale;
					this.plugin.settings.language = value as 'zh-CN' | 'en' | 'auto';
					await setLocale(locale);
					void this.plugin.saveSettings();
					// 语言切换后刷新设置面板
					this.display();
				});
			});

		new Setting(containerEl).setName(t('setting.workspace-and-chapters')).setHeading();

		new Setting(containerEl)
			.setName(t('setting.novel-info-filename'))
			.setDesc(t('setting.novel-info-filename-desc'))
			.addText(text => {
				const oldName = this.plugin.settings.novelInfo?.fileName || getDefaultFileName('novelInfoFileName');
				text.setPlaceholder(getDefaultFileName('novelInfoFileName'))
				.setValue(oldName);
				let tempValue = oldName;
				text.onChange((value) => { tempValue = value.trim().replace(/.md$/i, ''); });

				const saveAction = async () => {
					const newName = tempValue || getDefaultFileName('novelInfoFileName');
					if (newName === oldName) return;
					if (!this.plugin.settings.novelInfo) { this.plugin.settings.novelInfo = { fileName: newName }; }
					else { this.plugin.settings.novelInfo.fileName = newName; }
					await this.plugin.saveSettings();
					const count = await this.plugin.renameAllFunctionalFiles(oldName, newName, 'file', 'novelInfoFileName');
					if (count > 0) new Notice(t('notice.files-renamed', { count: String(count) }));
				};

				text.inputEl.addEventListener('change', () => { saveAction().catch(console.error); });
				text.inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); text.inputEl.blur(); } });
			});
		new Setting(containerEl)
			.setName(t('setting.enable-homepage'))
			.setDesc(t('setting.enable-homepage-desc'))
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
				.setName(t('setting.open-homepage-on-startup'))
				.setDesc(t('setting.open-homepage-on-startup-desc'))
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.openHomepageOnStartup)
					.onChange(async (value) => {
						this.plugin.settings.openHomepageOnStartup = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName(t('setting.custom-homepage-filename'))
				.setDesc(t('setting.custom-homepage-filename-desc'))
				.addText(text => {
					const currentPath = this.plugin.homepageManager?.getHomepageFilePath() || `${t('common.default-homepage-name')}.md`;
					const currentName = currentPath.split('/').pop()?.replace(/\.md$/, '') || t('common.default-homepage-name');

					text.setPlaceholder(t('setting.homepage-filename-placeholder'))
						.setValue(currentName);

					let tempValue = text.getValue();
					text.onChange((value) => { tempValue = value; });

					const saveAction = async () => {
						const basename = tempValue.trim() || t('common.default-homepage-name');
						const oldPath = this.plugin.homepageManager?.getHomepageFilePath() || `${t('common.default-homepage-name')}.md`;

						const lastSlash = oldPath.lastIndexOf('/');
						const oldDir = lastSlash >= 0 ? oldPath.substring(0, lastSlash + 1) : '';
						const newPath = oldDir + basename + '.md';

						if (newPath !== oldPath) {
							this.plugin.settings.homepagePath = newPath;
							await this.plugin.saveSettings();
							this.plugin.homepageManager?.renameHomepageFile(oldPath, newPath).catch(console.error);
							new Notice(t('notice.homepage-renamed', { name: basename }));
						}
					};

					text.inputEl.addEventListener('change', () => { saveAction().catch(console.error); });
					// 按回车也可以保存
					text.inputEl.addEventListener('keydown', (e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							text.inputEl.blur();
						}
					});
				});

			new Setting(containerEl)
				.setName(t('setting.custom-welcome'))
				.setDesc(t('setting.custom-welcome-desc'))
				.addText(text => text
					.setPlaceholder(t('common.default-welcome'))
					.setValue(this.plugin.settings.homepageWelcome || '')
					.onChange(async (value) => {
						this.plugin.settings.homepageWelcome = value.trim();
						await this.plugin.saveSettings();
						this.plugin.homepageManager?.refreshHomepageViews();
					}));

			new Setting(containerEl)
				.setName(t('setting.homepage-pin-position'))
				.setDesc(t('setting.homepage-pin-position-desc'))
				.addDropdown(dropdown => dropdown
					.addOptions({
						'none': t('setting.pin-none'),
						'top': t('setting.pin-top'),
						'bottom': t('setting.pin-bottom')
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
			.setName(t('setting.workspace-folders'))
			.setDesc(t('setting.workspace-folders-desc'))
			.addTextArea(text => {
				text.setPlaceholder(t('setting.workspace-folders-placeholder'))
					.setValue((this.plugin.settings.workspaceFolders || []).join(', '))
					.onChange(async (value) => {
						const oldFolders = this.plugin.settings.workspaceFolders || [];
						const oldFirst = oldFolders.length > 0 ? oldFolders[0].replace(/^\/+|\/+$/g, '') : '';
						
						// 记录在改变 workspaceFolders 之前的旧主页路径
						const currentPath = this.plugin.homepageManager?.getHomepageFilePath();

						this.plugin.settings.workspaceFolders = value.trim() ? value.split(',').map(f => f.trim()).filter(Boolean) : [];
						const newFolders = this.plugin.settings.workspaceFolders;
						const newFirst = newFolders.length > 0 ? newFolders[0].replace(/^\/+|\/+$/g, '') : '';
						
						if (oldFirst !== newFirst) {
							if (currentPath) {
								const basename = currentPath.split('/').pop() || `${t('common.default-homepage-name')}.md`;
								const expectedOldPath = oldFirst ? `${oldFirst}/${basename}` : basename;
								
								// 如果当前主页在原工作区根目录下，自动跟随移动到新工作区
								if (currentPath === expectedOldPath) {
									const newPath = newFirst ? `${newFirst}/${basename}` : basename;
									this.plugin.settings.homepagePath = newPath;
									this.plugin.homepageManager?.renameHomepageFile(currentPath, newPath).catch(console.error);
								}
							}
						}

						await this.plugin.saveSettings();
					});
				text.inputEl.addClass('webnovel-settings-input-full');
			});

		new Setting(containerEl)
			.setName(t('setting.strict-chapter-mode'))
			.setDesc(t('setting.strict-chapter-mode-desc'))
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
				.setName(t('setting.exception-directories'))
				.setDesc(t('setting.exception-directories-desc'))
				.addTextArea(text => {
					text
						.setPlaceholder(t('setting.exception-directories-placeholder'))
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
			.setName(t('setting.smart-chapter-sort'))
			.setDesc(t('setting.smart-chapter-sort-desc'))
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

		new Setting(containerEl).setName(t('setting.eyecare-mode')).setHeading();

		new Setting(containerEl)
			.setName(t('setting.enable-eyecare'))
			.setDesc(t('setting.enable-eyecare-desc'))
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
			.setName(t('setting.eyecare-bg-color'))
			.setDesc(t('setting.eyecare-bg-color-desc'))
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
				.setTooltip(t('setting.eyecare-reset-tooltip'))
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
		new Setting(containerEl).setName(t('setting.word-count-display')).setHeading();

		new Setting(containerEl)
			.setName(t('setting.word-count-mode'))
			.setDesc(t('setting.word-count-mode-desc'))
			.addDropdown(drop => drop
				.addOption('webnovel', t('setting.mode-webnovel'))
				.addOption('standard', t('setting.mode-standard'))
				.addOption('obsidian', t('setting.mode-obsidian'))
				.setValue(this.plugin.settings.wordCountMethod)
				.onChange(async (value: string) => {
					this.plugin.settings.wordCountMethod = value as 'webnovel' | 'standard' | 'obsidian';
					await this.plugin.saveSettings();
					new Notice(t('notice.word-count-recalculating'));
					await this.plugin.buildFolderCache();
					this.plugin.updateWordCount();
				}));

		new Setting(containerEl)
			.setName(t('setting.show-status-bar-progress'))
			.setDesc(t('setting.show-status-bar-progress-desc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showGoal)
				.onChange(async (value) => {
					this.plugin.settings.showGoal = value;
					await this.plugin.saveSettings();
					this.plugin.updateWordCount();
				}));

		new Setting(containerEl)
			.setName(t('setting.show-explorer-counts'))
			.setDesc(t('setting.show-explorer-counts-desc'))
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
				.setName(t('setting.enable-selection-count'))
				.setDesc(t('setting.enable-selection-count-desc'))
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.enableSelectionWordCount)
					.onChange(async (value) => {
						this.plugin.settings.enableSelectionWordCount = value;
						await this.plugin.saveSettings();
						// Reconfigure extensions if needed or it will check dynamically
					}));

			new Setting(containerEl)
				.setName(t('setting.word-count-gutter'))
				.setDesc(t('setting.word-count-gutter-desc'))
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.enableWordCountGutter)
					.onChange(async (value) => {
						this.plugin.settings.enableWordCountGutter = value;
						await this.plugin.saveSettings();
						this.app.workspace.trigger('webnovel:word-count-gutter-settings-changed');
						this.display(); // 刷新界面以显示/隐藏间隔输入框
					}));

			if (this.plugin.settings.enableWordCountGutter) {
				new Setting(containerEl)
					.setName(t('setting.word-count-interval'))
					.setDesc(t('setting.word-count-interval-desc'))
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
		}

		new Setting(containerEl).setName(t('setting.writing-goals')).setHeading();

		new Setting(containerEl)
			.setName(t('setting.default-chapter-goal'))
			.setDesc(t('setting.default-chapter-goal-desc'))
			.addText(text => text.setValue(this.plugin.settings.defaultGoal.toString()).onChange(async (v) => {
				const p = parseInt(v, 10); if (!isNaN(p)) { this.plugin.settings.defaultGoal = p; await this.plugin.saveSettings(); }
			}));

		new Setting(containerEl)
			.setName(t('setting.daily-goal'))
			.setDesc(t('setting.daily-goal-desc'))
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
		this.displayTaskSettings(containerEl);

		if (tier === 'desktop') {
			this.displayLoreSettings(containerEl);
		}
	}

	// ── 伏笔设置 ──
	private displayTaskSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t('setting.task-tracking')).setHeading();

		new Setting(containerEl)
			.setName(t('setting.task-filename'))
			.setDesc(t('setting.task-filename-desc'))
			.addText(text => {
				const oldName = this.plugin.settings.task?.fileName || getDefaultFileName('taskFileName');
				text.setPlaceholder(t('common.default-task-filename'))
					.setValue(oldName);
				let tempValue = oldName;
				text.onChange((value) => { tempValue = value.trim().replace(/.md$/i, ''); });

				const saveAction = async () => {
					const newName = tempValue || getDefaultFileName('taskFileName');
					if (newName === oldName) return;
					if (!this.plugin.settings.task) { this.plugin.settings.task = { fileName: newName }; }
					else { this.plugin.settings.task.fileName = newName; }
					await this.plugin.saveSettings();
					const count = await this.plugin.renameAllFunctionalFiles(oldName, newName, 'file', 'taskFileName');
					if (count > 0) new Notice(t('notice.files-renamed', { count: String(count) }));
				};

				text.inputEl.addEventListener('change', () => { saveAction().catch(console.error); });
				text.inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); text.inputEl.blur(); } });
			})

	}

	// ── 排序规则 ──
	private displaySortingRules(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('setting.sorting-rules'))
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
				const orderBtns = s.settingEl.createDiv({ cls: 'wn-settings-order-btns' });
				const upBtn = orderBtns.createEl('button', { text: '▲', attr: { title: t('setting.move-up') }, cls: 'wn-settings-order-btn' });
				const downBtn = orderBtns.createEl('button', { text: '▼', attr: { title: t('setting.move-down') }, cls: 'wn-settings-order-btn' });
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
						.setPlaceholder(t('common.rule-name-placeholder'))
						.onChange(async (value) => {
							rule.name = value;
							await this.plugin.saveSettings();
						});
					text.inputEl.addClass('webnovel-rule-name-input');
				});

				s.addText(text => {
					text.setValue(rule.pattern)
						.setPlaceholder(t('common.rule-pattern-placeholder'))
						.onChange(async (value) => {
							// [安全] ReDoS 防护：长度限制
							if (value.length > 200) {
								new Notice(t('notice.regex-too-long'));
								return;
							}

							// [安全] ReDoS 防护：禁止嵌套量词（如 (a+)+、(a*)*）
							if (/([+*])\)?[+*]/.test(value)) {
								new Notice(t('notice.regex-nested-quantifier'));
								return;
							}

							// [安全] 语法校验
							try {
								new RegExp(value, 'i');
							} catch {
								new Notice(t('notice.regex-invalid'));
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
					.setButtonText(t('common.delete'))
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
				.setButtonText(t('common.add-new-rule'))
				.onClick(async () => {
					this.plugin.settings.chapterNamingRules.push({ name: t('common.new-rule'), pattern: '^(\\d+)', enabled: true });
					await this.plugin.saveSettings();
					renderRules();
				}).buttonEl.addClass('webnovel-settings-btn-full'));
		};
		renderRules();
	}

	// ── 悬浮便签设置 ──
	private displayStickyNoteSettings(containerEl: HTMLElement): void {
		if (!isDesktop()) return;

		new Setting(containerEl).setName(t('setting.sticky-notes')).setHeading();

		new Setting(containerEl)
			.setName(t('setting.idle-opacity'))
			.addSlider(slider => slider.setLimits(0.1, 1, 0.05).setValue(this.plugin.settings.noteOpacity).onChange(async (v) => {
				this.plugin.settings.noteOpacity = v; await this.plugin.saveSettings();
				this.plugin.activeNotes.forEach((n: FloatingStickyNote) => n.updateVisuals());
			}));

		new Setting(containerEl)
			.setName(t('setting.sticky-note-autosave'))
			.setDesc(t('setting.sticky-note-autosave-desc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.stickyNoteAutoSave)
				.onChange(async (value) => {
					this.plugin.settings.stickyNoteAutoSave = value;
					await this.plugin.saveSettings();
				}));

		const colorSetting = new Setting(containerEl).setName(t('setting.theme-colors')).setDesc(t('setting.theme-colors-desc'));
		const colorContainer = colorSetting.controlEl.createDiv({ cls: 'wn-settings-color-grid' });
		this.plugin.settings.noteThemes.forEach((theme: ThemeScheme, index: number) => {
			const themeDiv = colorContainer.createDiv({ cls: 'wn-settings-color-item' });
			const bg = themeDiv.createEl('input', { type: 'color', value: theme.bg });
			const txt = themeDiv.createEl('input', { type: 'color', value: theme.text });
			bg.onchange = async (e) => { this.plugin.settings.noteThemes[index].bg = (e.target as HTMLInputElement).value; await this.plugin.saveSettings(); };
			txt.onchange = async (e) => { this.plugin.settings.noteThemes[index].text = (e.target as HTMLInputElement).value; await this.plugin.saveSettings(); };
		});
	}

	// ── 沉浸模式设置 ──
	private displayImmersiveLayoutBuilder(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('setting.immersive-layout-builder'))
			.setDesc(t('setting.immersive-layout-builder-desc'))
			.setHeading();

		const builderContainer = containerEl.createDiv('wn-layout-builder-container');
		this.renderLayoutBuilder(builderContainer);
	}

	private getAvailableViews(): Record<string, string> {
		return {
			'immersive-chapter-list-view': t('setting.layout-view-chapter-list'),
			'immersive-sticky-notes-view': t('setting.layout-view-sticky-notes'),
			'foreshadowing-view': t('setting.layout-view-foreshadowing'),
			'timeline-view': t('setting.layout-view-timeline'),
			'reference-view': t('setting.layout-view-reference'),
			'webnovel-corkboard': t('setting.layout-view-corkboard')
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
				list.createSpan({ text: t('setting.layout-empty'), cls: 'wn-slot-empty' });
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
			select.createEl('option', { text: t('setting.layout-add-component'), value: '' });
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
		createSlotEditor(topArea, t('setting.layout-top'), 'immersiveTopSlots');

		const middleArea = grid.createDiv('wn-layout-middle');

		const leftArea = middleArea.createDiv('wn-layout-left');
		createSlotEditor(leftArea, t('setting.layout-left'), 'immersiveLeftSlots');

		const centerArea = middleArea.createDiv('wn-layout-center');
		centerArea.createDiv({ text: t('setting.layout-center'), cls: 'wn-layout-center-text' });

		const rightArea = middleArea.createDiv('wn-layout-right');
		createSlotEditor(rightArea, t('setting.layout-right'), 'immersiveRightSlots');

		const bottomArea = grid.createDiv('wn-layout-bottom');
		createSlotEditor(bottomArea, t('setting.layout-bottom'), 'immersiveBottomSlots');
	}

	private displayImmersiveModeSettings(containerEl: HTMLElement): void {
		this.displayImmersiveLayoutBuilder(containerEl);

		new Setting(containerEl)
			.setName(t('setting.immersive-hide-properties'))
			.setDesc(t('setting.immersive-hide-properties-desc'))
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

		new Setting(containerEl).setName(t('setting.immersive-note-settings')).setHeading();

		new Setting(containerEl)
			.setName(t('setting.immersive-note-size'))
			.setDesc(t('setting.immersive-note-size-desc'))
			.addSlider(slider => slider
				.setLimits(150, 600, 10)
				.setValue(this.plugin.settings.immersive.immersiveNoteSize || 280)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.immersive.immersiveNoteSize = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('setting.immersive-note-font-size'))
			.setDesc(t('setting.immersive-note-font-size-desc'))
			.addSlider(slider => slider
				.setLimits(10, 30, 1)
				.setValue(this.plugin.settings.immersive.immersiveNoteFontSize || 14)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.immersive.immersiveNoteFontSize = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl).setName(t('setting.immersive-dashboard-toggles')).setHeading();

		new Setting(containerEl)
			.setName(t('setting.show-total-time'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersive.immersiveShowTotalTime)
				.onChange(async (value) => {
					this.plugin.settings.immersive.immersiveShowTotalTime = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('setting.show-focus-time'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersive.immersiveShowFocusTime)
				.onChange(async (value) => {
					this.plugin.settings.immersive.immersiveShowFocusTime = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('setting.show-slack-time'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersive.immersiveShowSlackTime)
				.onChange(async (value) => {
					this.plugin.settings.immersive.immersiveShowSlackTime = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('setting.show-chapter-progress'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersive.immersiveShowChapterProgress)
				.onChange(async (value) => {
					this.plugin.settings.immersive.immersiveShowChapterProgress = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('setting.show-daily-progress'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersive.immersiveShowDailyProgress)
				.onChange(async (value) => {
					this.plugin.settings.immersive.immersiveShowDailyProgress = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('setting.show-task-progress'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersive.immersiveShowTaskProgress)
				.onChange(async (value) => {
					this.plugin.settings.immersive.immersiveShowTaskProgress = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('setting.show-session-words'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersive.immersiveShowSessionWords)
				.onChange(async (value) => {
					this.plugin.settings.immersive.immersiveShowSessionWords = value;
					await this.plugin.saveSettings();
				}));
	}
	// ── 伏笔标注设置 ──
	private displayForeshadowingSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t('setting.foreshadowing')).setHeading();

		new Setting(containerEl)
			.setName(t('setting.foreshadowing-filename'))
			.setDesc(t('setting.foreshadowing-filename-desc'))
			.addText(text => {
				const oldName = this.plugin.settings.foreshadowing?.fileName || getDefaultFileName('foreshadowingFileName');
				text.setPlaceholder(t('common.default-foreshadowing-filename'))
					.setValue(oldName);
				let tempValue = oldName;
				text.onChange((value) => { tempValue = value.trim().replace(/.md$/i, ''); });

				const saveAction = async () => {
					const newName = tempValue || getDefaultFileName('foreshadowingFileName');
					if (newName === oldName) return;
					if (!this.plugin.settings.foreshadowing) { this.plugin.settings.foreshadowing = { fileName: newName, showTimestamp: true, defaultTags: [] }; }
					else { this.plugin.settings.foreshadowing.fileName = newName; }
					await this.plugin.saveSettings();
					const count = await this.plugin.renameAllFunctionalFiles(oldName, newName, 'file', 'foreshadowingFileName');
					if (count > 0) new Notice(t('notice.files-renamed', { count: String(count) }));
				};

				text.inputEl.addEventListener('change', () => { saveAction().catch(console.error); });
				text.inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); text.inputEl.blur(); } });
			})

		new Setting(containerEl)
			.setName(t('setting.show-timestamp'))
			.setDesc(t('setting.show-timestamp-desc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.foreshadowing?.showTimestamp !== false)
				.onChange(async (value) => {
					if (!this.plugin.settings.foreshadowing) {
						this.plugin.settings.foreshadowing = { fileName: getDefaultFileName('foreshadowingFileName'), showTimestamp: true, defaultTags: [] };
					}
					this.plugin.settings.foreshadowing.showTimestamp = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('setting.common-tags'))
			.setDesc(t('setting.common-tags-desc'))
			.addText(text => {
				const tags = this.plugin.settings.foreshadowing?.defaultTags || [];
				text
					.setPlaceholder(t('common.foreshadowing-tags-default'))
					.setValue(tags.join(', '))
					.onChange(async (value) => {
						if (!this.plugin.settings.foreshadowing) {
							this.plugin.settings.foreshadowing = { fileName: getDefaultFileName('foreshadowingFileName'), showTimestamp: true, defaultTags: [] };
						}
						this.plugin.settings.foreshadowing.defaultTags = value.trim()
							? value.trim().split(/[,，\s]+/).filter(Boolean)
							: [];
						await this.plugin.saveSettings();
					});
				text.inputEl.addClass('webnovel-settings-input-full');
			});
	}

	// ── 设定速查设置 ──
	private displayLoreSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t('setting.lore-lookup')).setHeading();

		const desc = activeDocument.createDocumentFragment();
		desc.append(
			t('setting.lore-folder-name-desc-prefix'),
			desc.createEl('br'),
			desc.createEl('strong', { text: t('setting.lore-folder-name-desc-hint') }),
			t('setting.lore-folder-name-desc')
		);

		new Setting(containerEl)
			.setName(t('setting.lore-folder-name'))
			.setDesc(desc)
			.addText(text => {
				const oldName = this.plugin.settings.loreFolderName || getDefaultFileName('loreFolderName');
				text.setPlaceholder(t('setting.lore-folder-name-placeholder'))
					.setValue(oldName);
				let tempValue = oldName;
				text.onChange((value: string) => { tempValue = value.trim(); });

				const saveAction = async () => {
					const newName = tempValue || getDefaultFileName('loreFolderName');
					if (newName === oldName) return;
					this.plugin.settings.loreFolderName = newName;
					await this.plugin.saveSettings();
					const count = await this.plugin.renameAllFunctionalFiles(oldName, newName, 'folder', 'loreFolderName');
					if (count > 0) new Notice(t('notice.files-renamed', { count: String(count) }));
				};

				text.inputEl.addEventListener('change', () => { saveAction().catch(console.error); });
				text.inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); text.inputEl.blur(); } });
			})
	}

	// ── 时间线设置 ──
	private displayTimelineSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t('setting.timeline')).setHeading();

		new Setting(containerEl)
			.setName(t('setting.timeline-filename'))
			.setDesc(t('setting.timeline-filename-desc'))
			.addText(text => {
				const oldName = this.plugin.settings.timeline?.fileName || getDefaultFileName('timelineFileName');
				text.setPlaceholder(t('common.default-timeline-filename'))
					.setValue(oldName);
				let tempValue = oldName;
				text.onChange((value) => { tempValue = value.trim().replace(/.md$/i, ''); });

				const saveAction = async () => {
					const newName = tempValue || getDefaultFileName('timelineFileName');
					if (newName === oldName) return;
					if (!this.plugin.settings.timeline) { this.plugin.settings.timeline = { fileName: newName, defaultTypes: [] }; }
					else { this.plugin.settings.timeline.fileName = newName; }
					await this.plugin.saveSettings();
					const count = await this.plugin.renameAllFunctionalFiles(oldName, newName, 'file', 'timelineFileName');
					if (count > 0) new Notice(t('notice.files-renamed', { count: String(count) }));
				};

				text.inputEl.addEventListener('change', () => { saveAction().catch(console.error); });
				text.inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); text.inputEl.blur(); } });
			})

		new Setting(containerEl)
			.setName(t('setting.timeline-default-types'))
			.setDesc(t('setting.timeline-default-types-desc'))
			.addText(text => {
				const types = this.plugin.settings.timeline?.defaultTypes || [];
				text
					.setPlaceholder(t('common.timeline-types-default'))
					.setValue(types.join(', '))
					.onChange(async (value) => {
						if (!this.plugin.settings.timeline) {
							this.plugin.settings.timeline = { fileName: getDefaultFileName('timelineFileName'), defaultTypes: [] };
						}
						this.plugin.settings.timeline.defaultTypes = value.trim()
							? value.trim().split(/[,，\s]+/).filter(Boolean)
							: [];
						await this.plugin.saveSettings();
					});
				text.inputEl.addClass('webnovel-settings-input-full');
			});
	}

	// ── 数据输出设置 ──
	private displayDataSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t('setting.focus-judgment')).setHeading();

		new Setting(containerEl)
			.setName(t('setting.idle-threshold'))
			.setDesc(t('setting.idle-threshold-desc'))
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
		new Setting(containerEl).setName(t('setting.obs-overlay')).setHeading();

		new Setting(containerEl)
			.setName(t('setting.enable-obs-overlay'))
			.setDesc(t('setting.enable-obs-overlay-desc'))
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
			.setName(t('setting.overlay-port'))
			.setDesc(t('setting.overlay-port-desc'))
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
							new Notice(t('notice.obs-overlay-restarted', { port: String(parsed) }));
						}
					} else if (!isNaN(parsed)) {
						new Notice(t('notice.port-range-invalid', { min: String(VALIDATION_RULES.PORT_RANGE.min), max: String(VALIDATION_RULES.PORT_RANGE.max) }));
					}
				}));

		new Setting(containerEl)
			.setName(t('setting.overlay-opacity'))
			.setDesc(t('setting.overlay-opacity-desc'))
			.addSlider(slider => slider
				.setLimits(0, 1, 0.05)
				.setValue(this.plugin.settings.obs.obsOverlayOpacity ?? 0.85)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.obs.obsOverlayOpacity = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('setting.custom-css'))
			.setDesc(t('setting.custom-css-desc'))
			.addTextArea(text => {
				text.setPlaceholder(t('common.custom-css-placeholder'))
					.setValue(this.plugin.settings.obs.obsCustomCss)
					.onChange(async (value) => {
						this.plugin.settings.obs.obsCustomCss = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.addClass('webnovel-obs-css-input');
				return text;
			});

		new Setting(containerEl)
			.setName(t('setting.overlay-theme'))
			.addDropdown(dropdown => {
				dropdown.addOption('dark', t('setting.theme-dark'));
				dropdown.addOption('light', t('setting.theme-light'));
				this.plugin.settings.noteThemes.forEach((theme: ThemeScheme, index: number) => {
					dropdown.addOption(`note-${index}`, t('setting.theme-note-preset', { index: String(index + 1) }));
				});
				dropdown.setValue(this.plugin.settings.obs.obsOverlayTheme);
				dropdown.onChange(async (value) => {
					this.plugin.settings.obs.obsOverlayTheme = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(t('obs.total-time'))
			.addToggle(toggle => toggle.setValue(this.plugin.settings.obs.obsShowTotalTime).onChange(async (v) => {
				this.plugin.settings.obs.obsShowTotalTime = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName(t('obs.focus-time'))
			.addToggle(toggle => toggle.setValue(this.plugin.settings.obs.obsShowFocusTime).onChange(async (v) => {
				this.plugin.settings.obs.obsShowFocusTime = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName(t('obs.slack-time'))
			.addToggle(toggle => toggle.setValue(this.plugin.settings.obs.obsShowSlackTime).onChange(async (v) => {
				this.plugin.settings.obs.obsShowSlackTime = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName(t('obs.daily-goal'))
			.addToggle(toggle => toggle.setValue(this.plugin.settings.obs.obsShowDailyGoal ?? true).onChange(async (v) => {
				this.plugin.settings.obs.obsShowDailyGoal = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName(t('obs.chapter-goal'))
			.addToggle(toggle => toggle.setValue(this.plugin.settings.obs.obsShowTodayWords).onChange(async (v) => {
				this.plugin.settings.obs.obsShowTodayWords = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName(t('obs.session-words'))
			.addToggle(toggle => toggle.setValue(this.plugin.settings.obs.obsShowSessionWords).onChange(async (v) => {
				this.plugin.settings.obs.obsShowSessionWords = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName(t('setting.copy-obs-url'))
			.setDesc(t('setting.copy-obs-url-desc'))
			.addButton(btn => btn
				.setButtonText(t('setting.btn-copy-url'))
				.onClick(() => {
					const url = `http://127.0.0.1:${this.plugin.settings.obs.obsPort}/`;
					void navigator.clipboard.writeText(url);
					new Notice(t('notice.obs-url-copied', { url }));
				}));
	}
}
