'use strict';

const electron = require('electron'); // eslint-disable-line no-undef
const settings = require('./settings'); // eslint-disable-line no-undef,no-unused-vars
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const Menu = electron.Menu;

let mainWindow = null;

let force_quit = false;
const appWidth = 1200;
const appHeight = 800;

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

app.on('ready', () => {
    Menu.setApplicationMenu(menu);

    // ブラウザ(Chromium)の起動, 初期画面のロード
    mainWindow = new BrowserWindow({width: appWidth, height: appHeight});
    const indexurl = `file://${__dirname.replace(/\\/g, '/')}/../maplist.html`; // eslint-disable-line no-undef
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


// メニュー情報の作成
var template = [
    {
        label: 'ReadUs',
        submenu: [
            {label: 'Quit', accelerator: 'CmdOrCtrl+Q', click() {app.quit();}}
        ]
    }, {
        label: "Edit",
        submenu: [
            // { label: "Undo", accelerator: "CmdOrCtrl+Z", selector: "undo:" },
            // { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", selector: "redo:" },
            // { type: "separator" },
            { label: "Cut", accelerator: "CmdOrCtrl+X", selector: "cut:" },
            { label: "Copy", accelerator: "CmdOrCtrl+C", selector: "copy:" },
            { label: "Paste", accelerator: "CmdOrCtrl+V", selector: "paste:" },
            { label: "Select All", accelerator: "CmdOrCtrl+A", selector: "selectAll:" }
    ]}, {



        label: 'File',
        submenu: [
            {label: 'Open', accelerator: 'Command+O', click() {
                // 「ファイルを開く」ダイアログの呼び出し
                const {dialog} = require('electron'); // eslint-disable-line no-undef
                dialog.showOpenDialog({ properties: ['openDirectory']}, function (baseDir){
                    if(baseDir && baseDir[0]) {
                        openWindow(baseDir[0]); // eslint-disable-line no-undef
                    }
                });
            }}
        ]
    }, {
        label: 'View',
        submenu: [
            {label: 'Reload', accelerator: 'Command+R', click() {
                BrowserWindow.getFocusedWindow().reload();
            }},
            {label: 'Toggle DevTools', accelerator: 'Alt+Command+I', click() {
                BrowserWindow.getFocusedWindow().toggleDevTools();
            }}
        ]
    }
];

const menu = Menu.buildFromTemplate(template);