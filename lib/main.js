'use strict';

var electron = require('electron');
var path = require('path');
var settings = require('./settings');
var app = electron.app;
var BrowserWindow = electron.BrowserWindow;
var Menu = electron.Menu;

var mainWindow = null;

var force_quit = false;
var appWidth = 1200;
var appHeight = 800;

app.on('window-all-closed', function() {
    if (process.platform != 'darwin')
        app.quit();
});

// This is another place to handle events after all windows are closed
app.on('will-quit', function () {
    // This is a good place to add tests insuring the app is still
    // responsive and all windows are closed.
    console.log("will-quit");
    mainWindow = null;
});

app.on('ready', function() {
    Menu.setApplicationMenu(menu);

    // ブラウザ(Chromium)の起動, 初期画面のロード
    mainWindow = new BrowserWindow({width: appWidth, height: appHeight});
    var indexurl = 'file://' + __dirname.replace(/\\/g, '/') + '/../maplist.html';
    mainWindow.loadURL(indexurl);
    mainWindow.setMinimumSize(appWidth, appHeight);

    // Continue to handle mainWindow "close" event here
    mainWindow.on('close', function(e){
        console.log("close");
        if(process.platform == 'darwin' && !force_quit){
            e.preventDefault();
            mainWindow.hide();
        }
    });

    // You can use 'before-quit' instead of (or with) the close event
    app.on('before-quit', function (e) {
        // Handle menu-item or keyboard shortcut quit here
        console.log("before-quit");
        force_quit = true;
    });

    app.on('activate', function(){
        console.log("reactive");
        mainWindow.show();
    });
});


// メニュー情報の作成
var template = [
    {
        label: 'ReadUs',
        submenu: [
            {label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: function () {app.quit();}},
            {
                label: 'Settings',
                accelerator: 'Command+S',
                click: function() {
                    var parent = BrowserWindow.getFocusedWindow();
                    var child = new BrowserWindow({parent: parent, modal: false, show: false, width: 650, height: 280, resizable: false });
                    child.loadURL('file://' + __dirname.replace(/\\/g, '/') + '/../settings.html');
                    var focusRejector = function() {
                        child.focus();
                    };
                    child.once('ready-to-show', function() {
                        child.show();
                    });
                    parent.on('focus', focusRejector);
                    child.once('close', function() {
                        parent.removeListener('focus', focusRejector);
                    });
                }
            }
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
            {label: 'Open', accelerator: 'Command+O', click: function() {
                // 「ファイルを開く」ダイアログの呼び出し
                const {dialog} = require('electron');
                dialog.showOpenDialog({ properties: ['openDirectory']}, function (baseDir){
                    if(baseDir && baseDir[0]) {
                        openWindow(baseDir[0]);
                    }
                });
            }}
        ]
    }, {
        label: 'View',
        submenu: [
            {label: 'Reload', accelerator: 'Command+R', click: function() {
                BrowserWindow.getFocusedWindow().reload();
            }},
            {label: 'Toggle DevTools', accelerator: 'Alt+Command+I', click: function() {
                BrowserWindow.getFocusedWindow().toggleDevTools();
            }}
        ]
    }
];

var menu = Menu.buildFromTemplate(template);