const webpack = require('webpack');
const pjson = require('./package.json');

/*const path = require('path');

if (process.platform === 'win32') {
    const utils = require('source-map/lib/util');
    const { urlParse, normalize, join, isAbsolute, relative } = utils;

    utils.normalize = function (aPath) { return toPath(normalize.call(this, (toUrl(aPath)))); }
    utils.join = function (aRoot, aPath) { return toPath(join.call(this, toUrl(aRoot), toUrl(aPath))); }
    utils.isAbsolute = function (aPath) { return isAbsolute.call(this, aPath) || path.isAbsolute(aPath); }
    utils.relative = function (aRoot, aPath) { return toPath(relative.call(this, toUrl(aRoot), toUrl(aPath))); }

    function toUrl(p) {
        if (!isAbsolute(p)) {
            p = encodeURI(p.replace(/\\/g, "/"));
            return (path.isAbsolute(p) ? "/" + p : p);
        }
        return p;
    }

    function toPath(url) {
        if (!urlParse(url)) {
            url = decodeURI(url).replace(/\//g, "\\");
            return (url.charAt(0) === "\\" ? url.slice(1) : url);
        }
    }
}*/

module.exports = {
    mode: 'production',
    devtool: 'source-map',
    entry: {
        maplist: './frontend/src/maplist.js',
        mapedit: './frontend/src/mapedit.js',
        webbridge: './tmpl/web-bridge.js'
    },
    output: {
        path: `${__dirname}/frontend/dist`,
        filename: '[name].bundle.js'
    },
    resolve: {
        alias: {
            'vue$': 'vue/dist/vue.esm.js'
        }
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules(?!\/@maplat)/,
                use: {
                    loader: 'babel-loader',
                    query: {
                        "presets": [
                            [
                                "@babel/preset-env",
                                {
                                    "useBuiltIns": "usage",
                                    "corejs": 3
                                }
                            ]
                        ]
                    }
                }
            }
        ]
    },
    externals: [
        (function () {
            var IGNORES = [
                'electron'
            ];
            return function (context, request, callback) {
                if (IGNORES.indexOf(request) >= 0) {
                    return callback(null, "require('" + request + "')");
                }
                return callback();
            };
        })()
    ]
};
