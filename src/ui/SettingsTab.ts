import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { isDesktop, isMobile } from '../utils/platform';
import { ObsOverlayServer } from '../services/ObsServer';

// 前向声明，避免循环依赖
type AccurateChineseCountPlugin = any;

/**
 * 插件设置面板
 * 提供所有配置选项的界面
 */
export class AccurateCountSettingTab extends PluginSettingTab {
	plugin: AccurateChineseCountPlugin;

	constructor(app: App, plugin: AccurateChineseCountPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		// 平台检测 - 移动端显示提示
		if (isMobile()) {
			const mobileNotice = containerEl.createDiv({
				cls: 'setting-item-description',
				attr: {
					style: 'background: var(--background-secondary); padding: 12px; border-radius: 6px; margin-bottom: 20px; border-left: 3px solid var(--interactive-accent);'
				}
			});
			mobileNotice.createEl('strong', { text: '💡 移动端模式' });
			mobileNotice.createEl('br');
			mobileNotice.appendText('部分高级功能(悬浮便签、OBS 直播叠加层、文本文件导出)仅在桌面端可用,以优化移动设备性能和电池续航。');
		}

		containerEl.createEl('h2', {text: '精准字数与目标设置'});

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

		new Setting(containerEl)
			.setName('显示文件列表字数')
			.setDesc('在侧边栏文件树中显示文件夹和文档的汇总字数。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showExplorerCounts)
				.onChange(async (value) => {
					this.plugin.settings.showExplorerCounts = value;
					await this.plugin.saveSettings();
					if (value) {
						await this.plugin.buildFolderCache();
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

		new Setting(containerEl)
			.setName('启用智能章节排序')
			.setDesc('自动识别章节编号（支持阿拉伯数字和中文数字），按数字大小排序而非字符串排序。例如："第1章"、"第2章"、"第10章"或"第一章"、"第二章"、"第十章"。')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableSmartChapterSort)
				.onChange(async (value) => {
					this.plugin.settings.enableSmartChapterSort = value;
					await this.plugin.saveSettings();
					
					if (value) {
						// 启用智能排序
						const success = this.plugin.fileExplorerPatcher.enable();
						if (success) {
							new Notice('✅ 智能章节排序已启用');
						} else {
							new Notice('❌ 启用失败，请重启 Obsidian 后重试');
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
						if (!this.plugin.obsServer) {
							this.plugin.obsServer = new ObsOverlayServer(this.plugin, this.plugin.settings.obsPort);
						}
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
					if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
						this.plugin.settings.obsPort = parsed;
						await this.plugin.saveSettings();
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
