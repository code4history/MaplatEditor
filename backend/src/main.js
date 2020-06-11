'use strict';

const electron = require('electron'); // eslint-disable-line no-undef
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const Menu = electron.Menu;
const fs = require('fs-extra'); // eslint-disable-line no-undef
const openAboutWindow =require('about-window').default; // eslint-disable-line no-undef
const Settings = require('./settings'); // eslint-disable-line no-undef

let settings;
let menuTemplate;
let mainWindow = null;

let force_quit = false;
const appWidth = 1200;
const appHeight = 800;

const isDev = isExistFile('.env');

const menuList = [
    'menu.quit',
    'menu.about',
    'menu.edit',
    'menu.undo',
    'menu.redo'
];

app.on('window-all-closed', () => {
    if (process.platform != 'darwin') // eslint-disable-line no-undef
        app.quit();
});

// This is another place to handle events after all windows are closed
app.on('will-quit', () => {
    // This is a good place to add tests insuring the app is still
    // responsive and all windows are closed.
    console.log("will-quit"); // eslint-disable-line no-console,no-undef
    mainWindow = null;
});

app.on('ready', async () => {
    settings = await Settings.asyncInit();
    const menu = setupMenu();
    Menu.setApplicationMenu(menu);
    settings.on('changeLang', () => {
        /*for (const m of menuList) {
            const item = menu.getMenuItemById(m);
            item.label = settings.t(m);
            console.log(settings.t(m));
        }*/
        menulabelChange();
        const menu = Menu.buildFromTemplate(menuTemplate);
        Menu.setApplicationMenu(menu);
    });

    // ブラウザ(Chromium)の起動, 初期画面のロード
    mainWindow = new BrowserWindow({width: appWidth, height: appHeight});
    const indexurl = `file://${__dirname.replace(/\\/g, '/')}/../../html/maplist.html`; // eslint-disable-line no-undef
    mainWindow.loadURL(indexurl);
    mainWindow.setMinimumSize(appWidth, appHeight);

    // Continue to handle mainWindow "close" event here
    mainWindow.on('close', (e) => {
        console.log("close"); // eslint-disable-line no-console,no-undef
        if(process.platform == 'darwin' && !force_quit){ // eslint-disable-line no-undef
            e.preventDefault();
            mainWindow.hide();
        }
    });

    // You can use 'before-quit' instead of (or with) the close event
    app.on('before-quit', () => {
        // Handle menu-item or keyboard shortcut quit here
        console.log("before-quit"); // eslint-disable-line no-console,no-undef
        force_quit = true;
    });

    app.on('activate', () => {
        console.log("reactive"); // eslint-disable-line no-console,no-undef
        mainWindow.show();
    });
});

function setupMenu() {
    const t = settings.t;
    // メニュー情報の作成
    menuTemplate = [
        {
            label: 'MaplatEditor',
            submenu: [
                {
                    id: 'menu.quit',
                    label: t('menu.quit'),
                    accelerator: 'CmdOrCtrl+Q',
                    click() {
                        app.quit();
                    }
                },
                {
                    type: 'separator',
                },
                {
                    id: 'menu.about',
                    label: t('menu.about'),
                    click() {
                        openAboutWindow({
                            icon_path: `file://${__dirname.replace(/\\/g, '/')}/../../img/icon.png`, // eslint-disable-line no-undef
                            product_name: 'MaplatEditor',
                            copyright: 'Copyright (c) 2015-2020 Code for History',
                            use_version_info: true,
                            win_options: {
                                title: settings.t('menu.about')
                            }
                        });
                    }
                },
            ]
        },
        {
            id: 'menu.edit',
            label: t('menu.edit'),
            submenu: [
                {
                    id: 'menu.undo',
                    label: t('menu.undo'),
                    accelerator: 'CmdOrCtrl+Z',
                    enabled: false,
                    click(menuItem, focusedWin) { // eslint-disable-line no-unused-vars
                        // Undo.
                        // focusedWin.webContents.undo();

                        // Run some custom code.
                    }
                },
                {
                    id: 'menu.redo',
                    label: t('menu.redo'),
                    accelerator: 'Shift+CmdOrCtrl+Z',
                    enabled: false,
                    click(menuItem, focusedWin) { // eslint-disable-line no-unused-vars
                        // Undo.
                        // focusedWin.webContents.undo();

                        // Run some custom code.
                    }
                }
                // { type: "separator" },
                // { label: "Cut", accelerator: "CmdOrCtrl+X", selector: "cut:" },
                // { label: "Copy", accelerator: "CmdOrCtrl+C", selector: "copy:" },
                // { label: "Paste", accelerator: "CmdOrCtrl+V", selector: "paste:" },
                // { label: "Select All", accelerator: "CmdOrCtrl+A", selector: "selectAll:" }
            ]
        }, /*{



        label: 'File',
        submenu: [
            {label: 'Open', accelerator: 'Command+O', click() {
                // 「ファイルを開く」ダイアログの呼び出し
                const {dialog} = require('electron'); // eslint-disable-line no-undef
                dialog.showOpenDialog({ properties: ['openDirectory']}, (baseDir) => {
                    if(baseDir && baseDir[0]) {
                        openWindow(baseDir[0]); // eslint-disable-line no-undef
                    }
                });
            }}
        ]
    }, */
    ];

    const devMenu = {
        id: 'menu.dev',
        label: t('menu.dev'),
        submenu: [
            {
                id: 'menu.reload',
                label: t('menu.reload'),
                accelerator: 'Command+R',
                click() {
                    BrowserWindow.getFocusedWindow().reload();
                }},
            {
                id: 'menu.tools',
                label: t('menu.tools'),
                accelerator: 'Alt+Command+I',
                click() {
                    BrowserWindow.getFocusedWindow().toggleDevTools();
                }}
        ]
    };

    if (isDev) {
        menuTemplate.push(devMenu);
        menuList.push('menu.dev', 'menu.reload', 'menu.tools');
    }

    const menu = Menu.buildFromTemplate(menuTemplate);
    return menu;
}

function menulabelChange(list) {
    if (!list) {
        list = menuList.reduce((prev, curr) => {
            prev[curr] = settings.t(curr);
            return prev;
        }, {});
    }
    menuTemplate.map((menu) => {
        if (list[menu.id]) menu.label = list[menu.id];
        if (menu.submenu) {
            menu.submenu.map((submenu) => {
                if (list[submenu.id]) submenu.label = list[submenu.id];
            });
        }
    });
}

function isExistFile(file) {
    try {
        fs.statSync(file);
        return true;
    } catch(err) {
        if(err.code === 'ENOENT') return false;
    }
}