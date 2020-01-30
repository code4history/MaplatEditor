const webpack = require('webpack');
const pjson = require('./package.json');

module.exports = {
    mode: 'production',
    devtool: 'source-map',
    entry: {
        maplist: './frontend/src/maplist.js',
        mapedit: './frontend/src/mapedit.js',
        applist: './frontend/src/applist.js',
        settings: './frontend/src/settings.js'
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
