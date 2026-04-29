import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { isDesktop, isMobile, getPlatformTier } from '../utils/platform';
import { ObsOverlayServer } from '../services/ObsServer';
import { ChapterSorter } from '../services/ChapterSorter';
import { MobileFloatingStats } from './MobileFloatingStats';
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
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl('h1', { text: 'WebNovel Assistant 设置' });

		// 创建选项卡头部
		const navContainer = containerEl.createDiv({ cls: 'webnovel-settings-tabs' });
		const tabs = [
			{ id: 'general', name: '基础设置' },
			{ id: 'immersive', name: '沉浸模式' },
			{ id: 'sticky', name: '悬浮便签' },
			{ id: 'creative', name: '创作工具' },
			{ id: 'obs', name: '直播输出' }
		];

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
		} else if (this.activeTab === 'immersive') {
			this.displayImmersiveModeSettings(containerEl);
		} else if (this.activeTab === 'sticky') {
			this.displayStickyNoteSettings(containerEl);
		} else if (this.activeTab === 'creative') {
			this.displayForeshadowingSettings(containerEl);
			this.displayTimelineSettings(containerEl);
			this.displayEyeCareSettings(containerEl);
		} else if (this.activeTab === 'obs') {
			this.displayDataSettings(containerEl);
		}
	}

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
						await this.plugin.saveSettings();
						if (value) {
							if (!this.plugin.mobileFloatingStats) this.plugin.mobileFloatingStats = new MobileFloatingStats(this.app, this.plugin);
							this.plugin.mobileFloatingStats.load();
						} else {
							this.plugin.mobileFloatingStats?.unload();
						}
					}));
		}

		containerEl.createEl('h2', {text: '核心功能设置'});

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
				text.inputEl.style.width = '100%';
			});

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

		new Setting(containerEl)
			.setName('默认章节目标')
			.addText(text => text.setValue(this.plugin.settings.defaultGoal.toString()).onChange(async (v) => {
				const p = parseInt(v); if (!isNaN(p)) { this.plugin.settings.defaultGoal = p; await this.plugin.saveSettings(); }
			}));

		new Setting(containerEl)
			.setName('当日新增目标')
			.addText(text => text.setValue((this.plugin.settings.dailyGoal || 5000).toString()).onChange(async (v) => {
				const p = parseInt(v); if (!isNaN(p)) { this.plugin.settings.dailyGoal = p; await this.plugin.saveSettings(); }
			}));

		if (isDesktop()) {
			new Setting(containerEl)
				.setName('启用智能章节排序')
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
		}
	}

	private displaySortingRules(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('排序规则配置')
			.setHeading();
		
		const rulesContainer = containerEl.createDiv({ style: 'width: 100%;' });
		
		const renderRules = () => {
			rulesContainer.empty();
			this.plugin.settings.chapterNamingRules.forEach((rule, index) => {
				const s = new Setting(rulesContainer);
				s.settingEl.style.background = 'var(--background-secondary)';
				s.settingEl.style.borderRadius = '8px';
				s.settingEl.style.marginBottom = '10px';
				s.settingEl.style.padding = '10px 15px';
				s.settingEl.style.borderTop = 'none';
				s.settingEl.style.display = 'flex';
				s.settingEl.style.alignItems = 'center';
				s.settingEl.style.gap = '10px';
				
				// 移除默认的 info 区域，腾出空间
				s.infoEl.remove();

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
					text.inputEl.style.flex = '1 1 0px';
					text.inputEl.style.minWidth = '0';
				});

				s.addText(text => {
					text.setValue(rule.pattern)
						.setPlaceholder('正则表达式')
						.onChange(async (value) => {
							rule.pattern = value;
							await this.plugin.saveSettings();
							ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules);
							this.plugin.fileExplorerPatcher.refreshManually();
						});
					text.inputEl.style.flex = '3 1 0px';
					text.inputEl.style.minWidth = '0';
					text.inputEl.style.fontFamily = 'monospace';
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
			addBtnRow.settingEl.style.borderTop = 'none';
			addBtnRow.settingEl.style.padding = '0';
			addBtnRow.addButton(btn => btn
				.setButtonText('+ 添加新规则')
				.onClick(async () => {
					this.plugin.settings.chapterNamingRules.push({ name: '新规则', pattern: '^(\\d+)', enabled: true });
					await this.plugin.saveSettings();
					renderRules();
				}).buttonEl.style.width = '100%');
		};
		renderRules();
	}

	private displayStickyNoteSettings(containerEl: HTMLElement): void {
		if (!isDesktop()) {
			containerEl.createEl('p', { text: '⚠️ 悬浮便签功能仅在桌面端可用。', cls: 'setting-item-description' });
			return;
		}

		containerEl.createEl('h2', {text: '悬浮便签 (Sticky Notes)'});
		
		new Setting(containerEl)
			.setName('闲置透明度')
			.addSlider(slider => slider.setLimits(0.1, 1, 0.05).setValue(this.plugin.settings.noteOpacity).onChange(async (v) => {
				this.plugin.settings.noteOpacity = v; await this.plugin.saveSettings();
				this.plugin.activeNotes.forEach((n: any) => n.updateVisuals());
			}));

		const colorSetting = new Setting(containerEl).setName('主题色方案').setDesc('自定义 6 种预设配色。');
		const colorContainer = colorSetting.controlEl.createDiv({ attr: { style: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;' } });
		
		this.plugin.settings.noteThemes.forEach((theme: any, index: number) => {
			const themeDiv = colorContainer.createDiv({ attr: { style: 'display: flex; align-items: center; gap: 4px; background: var(--background-modifier-form-field); padding: 4px; border-radius: 4px;' } });
			const bg = themeDiv.createEl('input', { type: 'color', value: theme.bg });
			const txt = themeDiv.createEl('input', { type: 'color', value: theme.text });
			bg.onchange = async (e) => { this.plugin.settings.noteThemes[index].bg = (e.target as HTMLInputElement).value; await this.plugin.saveSettings(); };
			txt.onchange = async (e) => { this.plugin.settings.noteThemes[index].text = (e.target as HTMLInputElement).value; await this.plugin.saveSettings(); };
		});
	}

	private displayImmersiveModeSettings(containerEl: HTMLElement): void {

		containerEl.createEl('h3', { text: '辅助面板开关' });
		containerEl.createEl('p', {
			text: '自由拼接您的沉浸空间。辅助面板的位置可在下方统一设置。',
			cls: 'setting-item-description'
		});

		new Setting(containerEl)
			.setName('显示左侧章节列表')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersiveShowChapterList)
				.onChange(async (value) => {
					this.plugin.settings.immersiveShowChapterList = value;
					// 清除保存的布局快照，强制重新生成
					this.plugin.settings.immersiveLayout = null;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('显示右侧参考文档区')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersiveShowReference)
				.onChange(async (value) => {
					this.plugin.settings.immersiveShowReference = value;
					// 清除保存的布局快照，强制重新生成
					this.plugin.settings.immersiveLayout = null;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('显示悬浮便签陈列区')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersiveShowStickyNotes)
				.onChange(async (value) => {
					this.plugin.settings.immersiveShowStickyNotes = value;
					// 清除保存的布局快照，强制重新生成
					this.plugin.settings.immersiveLayout = null;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('显示伏笔面板')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersiveShowForeshadowing)
				.onChange(async (value) => {
					this.plugin.settings.immersiveShowForeshadowing = value;
					// 清除保存的布局快照，强制重新生成
					this.plugin.settings.immersiveLayout = null;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('显示时间线面板')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersiveShowTimeline)
				.onChange(async (value) => {
					this.plugin.settings.immersiveShowTimeline = value;
					// 清除保存的布局快照，强制重新生成
					this.plugin.settings.immersiveLayout = null;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('辅助面板显示位置')
			.setDesc('辅助面板（便签、伏笔、时间线）作为一个整体显示在主编辑区的上方或下方。')
			.addDropdown(dropdown => dropdown
				.addOption('bottom', '主视图下方')
				.addOption('top', '主视图上方')
				.setValue(this.plugin.settings.immersivePanelPosition || 'bottom')
				.onChange(async (value) => {
					this.plugin.settings.immersivePanelPosition = value as 'top' | 'bottom';
					// 清除保存的布局快照，强制重新生成以应用位置更改
					this.plugin.settings.immersiveLayout = null;
					await this.plugin.saveSettings();
					new Notice(`位置已切换为: ${value === 'top' ? '上方' : '下方'}，下次进入沉浸模式生效`);
				}));

		containerEl.createEl('h3', { text: '顶部仪表盘数据开关' });

		new Setting(containerEl)
			.setName('显示总计时间')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersiveShowTotalTime)
				.onChange(async (value) => {
					this.plugin.settings.immersiveShowTotalTime = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('显示专注时间')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersiveShowFocusTime)
				.onChange(async (value) => {
					this.plugin.settings.immersiveShowFocusTime = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('显示摸鱼时间')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersiveShowSlackTime)
				.onChange(async (value) => {
					this.plugin.settings.immersiveShowSlackTime = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('显示章节目标进度')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersiveShowChapterProgress)
				.onChange(async (value) => {
					this.plugin.settings.immersiveShowChapterProgress = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('显示今日目标进度')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersiveShowDailyProgress)
				.onChange(async (value) => {
					this.plugin.settings.immersiveShowDailyProgress = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('显示本场净增')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.immersiveShowSessionWords)
				.onChange(async (value) => {
					this.plugin.settings.immersiveShowSessionWords = value;
					await this.plugin.saveSettings();
				}));
	}

	private displayForeshadowingSettings(containerEl: HTMLElement): void {
		containerEl.createEl('h2', { text: '伏笔标注设置' });

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
				text.inputEl.style.width = '100%';
			});
	}

	private displayTimelineSettings(containerEl: HTMLElement): void {
		containerEl.createEl('h2', { text: '时间线设置' });

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
				text.inputEl.style.width = '100%';
			});
	}

	private displayEyeCareSettings(containerEl: HTMLElement): void {
		containerEl.createEl('h2', { text: '护眼模式' });

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
					this.display(); // 刷新设置页面
				}));
	}

	private displayDataSettings(containerEl: HTMLElement): void {
		containerEl.createEl('h2', {text: '数据统计与输出设置'});

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
		this.displayLegacyExportSettings(containerEl);
	}

	private displayObsSettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('启用 OBS 直播叠加层')
			.setDesc('在本地启动 HTTP 服务，OBS 通过「浏览器源」加载实时统计面板，零磁盘 I/O。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableObs)
				.onChange(async (value) => {
					this.plugin.settings.enableObs = value;
					await this.plugin.saveSettings();
					if (value) {
						// 先停止旧服务器（如果存在）
						if (this.plugin.obsServer) {
							this.plugin.obsServer.stop();
						}
						// 使用当前端口创建新服务器
						this.plugin.obsServer = new ObsOverlayServer(this.plugin, this.plugin.settings.obsPort);
						this.plugin.obsServer.start();
					} else {
						this.plugin.obsServer?.stop();
					}
				}));

		new Setting(containerEl)
			.setName('叠加层端口')
			.setDesc('OBS 浏览器源访问的端口号，修改后需重启叠加层。')
			.addText(text => text
				.setValue(this.plugin.settings.obsPort.toString())
				.onChange(async (value) => {
					const parsed = parseInt(value);
					if (parsed >= VALIDATION_RULES.PORT_RANGE.min && 
					    parsed <= VALIDATION_RULES.PORT_RANGE.max) {
						this.plugin.settings.obsPort = parsed;
						await this.plugin.saveSettings();
						
						// 如果 OBS 服务器正在运行，重启以应用新端口
						if (this.plugin.settings.enableObs && this.plugin.obsServer) {
							this.plugin.obsServer.stop();
							this.plugin.obsServer = new ObsOverlayServer(this.plugin, this.plugin.settings.obsPort);
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
				.setValue(this.plugin.settings.obsOverlayOpacity ?? 0.85)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.obsOverlayOpacity = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('自定义 CSS')
			.setDesc('通过覆盖 CSS 类名修改样式')
			.addTextArea(text => {
				text.setPlaceholder('/* 例：修改摸鱼时间为绿色 */ .time-value.slack { color: #4CAF50 !important; }')
					.setValue(this.plugin.settings.obsCustomCss)
					.onChange(async (value) => {
						this.plugin.settings.obsCustomCss = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.style.cssText = 'width: 100%; height: 100px; font-family: monospace;';
				return text;
			});

		new Setting(containerEl)
			.setName('叠加层主题')
			.addDropdown(dropdown => {
				dropdown.addOption('dark', '暗色 (深色背景+白字)');
				dropdown.addOption('light', '亮色 (浅色背景+深字)');
				this.plugin.settings.noteThemes.forEach((theme: any, index: number) => {
					dropdown.addOption(`note-${index}`, `便签预设色 ${index + 1}`);
				});
				dropdown.setValue(this.plugin.settings.obsOverlayTheme);
				dropdown.onChange(async (value) => {
					this.plugin.settings.obsOverlayTheme = value;
					await this.plugin.saveSettings();
				});
			});

		// OBS 显示选项
		new Setting(containerEl)
			.setName('显示总计时间')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.obsShowTotalTime).onChange(async (v) => { 
				this.plugin.settings.obsShowTotalTime = v; 
				await this.plugin.saveSettings(); 
			}));
		
		new Setting(containerEl)
			.setName('显示专注时间')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.obsShowFocusTime).onChange(async (v) => { 
				this.plugin.settings.obsShowFocusTime = v; 
				await this.plugin.saveSettings(); 
			}));
		
		new Setting(containerEl)
			.setName('显示摸鱼时间')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.obsShowSlackTime).onChange(async (v) => { 
				this.plugin.settings.obsShowSlackTime = v; 
				await this.plugin.saveSettings(); 
			}));
		
		new Setting(containerEl)
			.setName('显示当日目标进度')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.obsShowDailyGoal ?? true).onChange(async (v) => {
				this.plugin.settings.obsShowDailyGoal = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName('显示章节目标进度')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.obsShowTodayWords).onChange(async (v) => { 
				this.plugin.settings.obsShowTodayWords = v; 
				await this.plugin.saveSettings(); 
			}));
		
		new Setting(containerEl)
			.setName('显示本场净增')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.obsShowSessionWords).onChange(async (v) => { 
				this.plugin.settings.obsShowSessionWords = v; 
				await this.plugin.saveSettings(); 
			}));

		new Setting(containerEl)
			.setName('复制 OBS 叠加层 URL')
			.setDesc('点击后复制 URL，在 OBS 中添加「浏览器源」并粘贴此 URL。')
			.addButton(btn => btn
				.setButtonText('复制 URL')
				.onClick(() => {
					const url = `http://127.0.0.1:${this.plugin.settings.obsPort}/`;
					navigator.clipboard.writeText(url);
					new Notice(`已复制: ${url}`);
				}));
	}

	private displayLegacyExportSettings(containerEl: HTMLElement): void {
		containerEl.createEl('h3', {text: '文本文件导出 (兼容)'});
		
		new Setting(containerEl)
			.setName('启用本地文本文件导出')
			.setDesc('开启后，插件将像以前一样每秒将专注时间、摸鱼时间等数据写入纯文本文件中。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableLegacyObsExport)
				.onChange(async (value) => {
					this.plugin.settings.enableLegacyObsExport = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('数据输出路径 (绝对路径)')
			.setDesc('请填入绝对路径 (例如 D:\\OBS\\Stats)')
			.addText(text => text
				.setPlaceholder('请输入文件夹路径')
				.setValue(this.plugin.settings.obsPath)
				.onChange(async (value) => {
					this.plugin.settings.obsPath = value;
					await this.plugin.saveSettings();
				}));
	}
}
