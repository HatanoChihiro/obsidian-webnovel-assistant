import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { isDesktop, isMobile, getPlatformTier } from '../utils/platform';
import { ObsOverlayServer } from '../services/ObsServer';
import { MobileFloatingStats } from './MobileFloatingStats';
import { VALIDATION_RULES } from '../constants';
import type { WebNovelAssistantPlugin } from '../types/plugin';

/**
 * 插件设置面板
 * 提供所有配置选项的界面
 */
export class AccurateCountSettingTab extends PluginSettingTab {
	plugin: WebNovelAssistantPlugin;

	constructor(app: App, plugin: WebNovelAssistantPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		// 平台检测 - 显示对应提示
		const tier = getPlatformTier();
		if (tier === 'mobile') {
			const mobileNotice = containerEl.createDiv({
				cls: 'setting-item-description',
				attr: {
					style: 'background: var(--background-secondary); padding: 12px; border-radius: 6px; margin-bottom: 20px; border-left: 3px solid var(--interactive-accent);'
				}
			});
			mobileNotice.createEl('strong', { text: '📱 移动端模式' });
			mobileNotice.createEl('br');
			mobileNotice.appendText('部分高级功能(面板、悬浮便签、OBS)仅在桌面端或平板端可用,以优化移动设备性能和电池续航。');
			
			// 移动端专属设置
			containerEl.createEl('h2', {text: '移动端设置'});
			
			new Setting(containerEl)
				.setName('显示浮动字数统计')
				.setDesc('在屏幕上显示一个小巧的浮动窗口，实时显示字数和进度。可拖动位置。')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.showMobileFloatingStats)
					.onChange(async (value) => {
						this.plugin.settings.showMobileFloatingStats = value;
						await this.plugin.saveSettings();
						
						// 立即应用更改
						if (value) {
							if (!this.plugin.mobileFloatingStats) {
								this.plugin.mobileFloatingStats = new MobileFloatingStats(this.app, this.plugin);
							}
							this.plugin.mobileFloatingStats.load();
						} else {
							this.plugin.mobileFloatingStats?.unload();
						}
					}));
		} else if (tier === 'tablet') {
			const tabletNotice = containerEl.createDiv({
				cls: 'setting-item-description',
				attr: {
					style: 'background: var(--background-secondary); padding: 12px; border-radius: 6px; margin-bottom: 20px; border-left: 3px solid var(--interactive-accent);'
				}
			});
			tabletNotice.createEl('strong', { text: '📱 平板端模式' });
			tabletNotice.createEl('br');
			tabletNotice.appendText('已启用面板功能（伏笔、时间线、状态视图）。悬浮便签和 OBS 功能仅在桌面端可用。');
			
			// 平板端专属设置
			containerEl.createEl('h2', {text: '平板端设置'});
			
			new Setting(containerEl)
				.setName('显示浮动字数统计')
				.setDesc('在屏幕上显示一个小巧的浮动窗口，实时显示字数和进度。可拖动位置。')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.showMobileFloatingStats)
					.onChange(async (value) => {
						this.plugin.settings.showMobileFloatingStats = value;
						await this.plugin.saveSettings();
						
						// 立即应用更改
						if (value) {
							if (!this.plugin.mobileFloatingStats) {
								this.plugin.mobileFloatingStats = new MobileFloatingStats(this.app, this.plugin);
							}
							this.plugin.mobileFloatingStats.load();
						} else {
							this.plugin.mobileFloatingStats?.unload();
						}
					}));
		}

		containerEl.createEl('h2', {text: '精准字数与目标设置'});

		new Setting(containerEl)
			.setName('工作区文件夹')
			.setDesc('插件功能只在指定的文件夹下生效，留空则全局生效。多个文件夹用逗号分隔。')
			.addTextArea(text => {
				const folders = this.plugin.settings.workspaceFolders || [];
				text
					.setPlaceholder('例如：小说/第一卷, 小说/第二卷')
					.setValue(folders.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.workspaceFolders = value.trim()
							? value.split(',').map(f => f.trim()).filter(Boolean)
							: [];
						await this.plugin.saveSettings();
					});
				text.inputEl.style.width = '100%';
				text.inputEl.style.minHeight = '60px';
			});

		// 桌面端才显示"显示章节目标进度"设置（移动端状态栏不支持显示进度）
		if (!isMobile()) {
			new Setting(containerEl)
				.setName('显示章节目标进度')
				.setDesc('在状态栏显示当前文件的字数完成进度。')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.showGoal)
					.onChange(async (value) => {
						this.plugin.settings.showGoal = value;
						await this.plugin.saveSettings();
						this.plugin.updateWordCount();
					}));
		}

		new Setting(containerEl)
			.setName('显示文件列表字数')
			.setDesc('在侧边栏文件树中显示文件夹和文档的汇总字数。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showExplorerCounts)
				.onChange(async (value) => {
					this.plugin.settings.showExplorerCounts = value;
					await this.plugin.saveSettings();
					if (value) {
						// 移动端需要延迟，确保文件浏览器已加载
						if (isMobile()) {
							new Notice('正在构建缓存，请稍候...');
							setTimeout(async () => {
								await this.plugin.buildFolderCache();
							}, 1000);
						} else {
							await this.plugin.buildFolderCache();
						}
					} else {
						this.plugin.refreshFolderCounts();
					}
				}));

		new Setting(containerEl)
			.setName('默认章节目标字数')
			.setDesc('每个章节的目标字数，可在文件 frontmatter 中用 word-goal 单独设置。')
			.addText(text => text
				.setValue(this.plugin.settings.defaultGoal.toString())
				.onChange(async (value) => {
					const parsed = parseInt(value);
					if (!isNaN(parsed)) {
						this.plugin.settings.defaultGoal = parsed;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('当日目标字数')
			.setDesc('今日新增字数的目标，用于跟踪每日写作进度。')
			.addText(text => text
				.setValue((this.plugin.settings.dailyGoal || 5000).toString())
				.onChange(async (value) => {
					const parsed = parseInt(value);
					if (!isNaN(parsed)) {
						this.plugin.settings.dailyGoal = parsed;
						await this.plugin.saveSettings();
					}
				}));

		// 智能章节排序（仅桌面端）
		if (isDesktop()) {
			new Setting(containerEl)
				.setName('启用智能章节排序')
				.setDesc('自动识别章节编号（支持自定义规则），按数字大小排序而非字符串排序。')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.enableSmartChapterSort)
					.onChange(async (value) => {
						this.plugin.settings.enableSmartChapterSort = value;
						await this.plugin.saveSettings();
						
						if (value) {
							// 启用智能排序
							const success = this.plugin.fileExplorerPatcher.enable();
							if (success) {
								new Notice('[成功] 智能章节排序已启用');
							} else {
								new Notice('[错误] 启用失败，请重启 Obsidian 后重试');
								this.plugin.settings.enableSmartChapterSort = false;
								await this.plugin.saveSettings();
								toggle.setValue(false);
							}
						} else {
							// 禁用智能排序
							this.plugin.fileExplorerPatcher.disable();
							new Notice('智能章节排序已禁用');
						}
					}));

			// 章节命名规则设置
			if (this.plugin.settings.enableSmartChapterSort) {
				containerEl.createEl('h3', { text: '章节命名规则' });
				containerEl.createEl('p', {
					text: '自定义章节命名规则，只有匹配的章节才会参与排序和合并。规则按顺序匹配，决定大块排序。',
					cls: 'setting-item-description'
				});

				// 确保规则数组存在
				if (!this.plugin.settings.chapterNamingRules) {
					this.plugin.settings.chapterNamingRules = [
						{ name: '阿拉伯数字（第1章、第01章）', pattern: '^第?(\\d+)[章节回卷部册篇]?', enabled: true },
						{ name: '中文数字（第一章、第二章）', pattern: '^第?([零一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬〇]+)[章节回卷部册篇]?', enabled: true },
						{ name: '纯数字（1、01、001）', pattern: '^(\\d+)$', enabled: true },
					];
				}

				const rulesContainer = containerEl.createDiv({ cls: 'chapter-naming-rules-container' });
				rulesContainer.style.cssText = 'margin-bottom:20px;';

				const renderRules = () => {
					rulesContainer.empty();
					this.plugin.settings.chapterNamingRules.forEach((rule, index) => {
						const ruleEl = rulesContainer.createDiv({ cls: 'chapter-naming-rule' });
						ruleEl.style.cssText = 'padding:12px;margin-bottom:8px;background:var(--background-secondary);border-radius:6px;';

						const headerRow = ruleEl.createDiv();
						headerRow.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;';

						// 启用/禁用开关
						const toggle = headerRow.createEl('input', { type: 'checkbox' });
						toggle.checked = rule.enabled;
						toggle.style.cssText = 'cursor:pointer;';
						toggle.onchange = async () => {
							rule.enabled = toggle.checked;
							await this.plugin.saveSettings();
							// 更新 ChapterSorter
							const { ChapterSorter } = await import('../services/ChapterSorter');
							ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules);
							this.plugin.fileExplorerPatcher.refreshManually();
						};

						// 规则名称
						const nameInput = headerRow.createEl('input', { type: 'text', value: rule.name });
						nameInput.style.cssText = 'flex:1;padding:4px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);';
						nameInput.onchange = async () => {
							rule.name = nameInput.value;
							await this.plugin.saveSettings();
						};

						// 上移/下移按钮
						if (index > 0) {
							const upBtn = headerRow.createEl('button', { text: '↑' });
							upBtn.style.cssText = 'padding:2px 8px;cursor:pointer;';
							upBtn.onclick = async () => {
								const temp = this.plugin.settings.chapterNamingRules[index - 1];
								this.plugin.settings.chapterNamingRules[index - 1] = this.plugin.settings.chapterNamingRules[index];
								this.plugin.settings.chapterNamingRules[index] = temp;
								await this.plugin.saveSettings();
								const { ChapterSorter } = await import('../services/ChapterSorter');
								ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules);
								this.plugin.fileExplorerPatcher.refreshManually();
								renderRules();
							};
						}
						if (index < this.plugin.settings.chapterNamingRules.length - 1) {
							const downBtn = headerRow.createEl('button', { text: '↓' });
							downBtn.style.cssText = 'padding:2px 8px;cursor:pointer;';
							downBtn.onclick = async () => {
								const temp = this.plugin.settings.chapterNamingRules[index + 1];
								this.plugin.settings.chapterNamingRules[index + 1] = this.plugin.settings.chapterNamingRules[index];
								this.plugin.settings.chapterNamingRules[index] = temp;
								await this.plugin.saveSettings();
								const { ChapterSorter } = await import('../services/ChapterSorter');
								ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules);
								this.plugin.fileExplorerPatcher.refreshManually();
								renderRules();
							};
						}

						// 删除按钮
						const deleteBtn = headerRow.createEl('button', { text: '删除' });
						deleteBtn.style.cssText = 'padding:2px 8px;cursor:pointer;color:var(--text-error);';
						deleteBtn.onclick = async () => {
							this.plugin.settings.chapterNamingRules.splice(index, 1);
							await this.plugin.saveSettings();
							const { ChapterSorter } = await import('../services/ChapterSorter');
							ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules);
							this.plugin.fileExplorerPatcher.refreshManually();
							renderRules();
						};

						// 正则表达式输入
						const patternRow = ruleEl.createDiv();
						patternRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
						patternRow.createSpan({ text: '正则：', cls: 'setting-item-description' });
						const patternInput = patternRow.createEl('input', { type: 'text', value: rule.pattern });
						patternInput.style.cssText = 'flex:1;padding:4px 8px;border-radius:4px;border:1px solid var(--background-modifier-border);background:var(--background-primary);font-family:monospace;';
						patternInput.onchange = async () => {
							rule.pattern = patternInput.value;
							await this.plugin.saveSettings();
							const { ChapterSorter } = await import('../services/ChapterSorter');
							ChapterSorter.setCustomRules(this.plugin.settings.chapterNamingRules);
							this.plugin.fileExplorerPatcher.refreshManually();
						};
					});

					// 添加新规则按钮
					const addBtn = rulesContainer.createEl('button', { text: '+ 添加新规则' });
					addBtn.style.cssText = 'padding:8px 16px;cursor:pointer;';
					addBtn.onclick = async () => {
						this.plugin.settings.chapterNamingRules.push({
							name: '新规则',
							pattern: '^(\\d+)',
							enabled: true
						});
						await this.plugin.saveSettings();
						renderRules();
					};
				};

				renderRules();
			}
		}

		// 移动端隐藏桌面专属功能
		if (isDesktop()) {
			this.displayDesktopSettings(containerEl);
		}
	}

	private displayDesktopSettings(containerEl: HTMLElement): void {
		containerEl.createEl('h2', {text: '悬浮便签设置'});
		
		new Setting(containerEl)
			.setName('闲置时透明度 (仅背景)')
			.setDesc('调节便签在闲置时的纯背景透明度。拖动滑块时已打开的便签会实时预览！')
			.addSlider(slider => slider
				.setLimits(0.1, 1, 0.05)
				.setValue(this.plugin.settings.noteOpacity)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.noteOpacity = value;
					await this.plugin.saveSettings();
					this.plugin.activeNotes.forEach((note: any) => note.updateVisuals());
				}));

		const colorSetting = new Setting(containerEl)
			.setName('自定义主题方案 (背景色 + 文字色)')
			.setDesc('自定义便签调色板中的 6 种预设组合。左侧为背景色，右侧为对应的文字/图标色。');
		
		const colorContainer = colorSetting.controlEl.createDiv({ 
			attr: { style: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;' } 
		});
		
		this.plugin.settings.noteThemes.forEach((theme: any, index: number) => {
			const themeDiv = colorContainer.createDiv({ 
				attr: { style: 'display: flex; align-items: center; gap: 6px; background: var(--background-modifier-form-field); padding: 4px 8px; border-radius: 6px;' } 
			});
			
			const bgInput = themeDiv.createEl('input', { type: 'color', value: theme.bg });
			bgInput.style.cssText = 'cursor: pointer; border: none; padding: 0; width: 24px; height: 24px; border-radius: 4px;';
			
			themeDiv.createSpan({ 
				text: 'Aa', 
				attr: { style: 'font-weight: bold; font-family: serif; color: var(--text-muted); padding-left: 2px;' } 
			});
			
			const textInput = themeDiv.createEl('input', { type: 'color', value: theme.text });
			textInput.style.cssText = 'cursor: pointer; border: none; padding: 0; width: 24px; height: 24px; border-radius: 4px;';

			bgInput.onchange = async (e) => {
				this.plugin.settings.noteThemes[index].bg = (e.target as HTMLInputElement).value;
				await this.plugin.saveSettings();
			};
			textInput.onchange = async (e) => {
				this.plugin.settings.noteThemes[index].text = (e.target as HTMLInputElement).value;
				await this.plugin.saveSettings();
			};
		});

		this.displayForeshadowingSettings(containerEl);
		this.displayTimelineSettings(containerEl);
		this.displayEyeCareSettings(containerEl);
		this.displayDataSettings(containerEl);
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
