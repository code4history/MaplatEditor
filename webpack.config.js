const webpack = require('webpack');
const pjson = require('./package.json');
const VueLoaderPlugin = require('vue-loader/lib/plugin');

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
    },
    symlinks: false
  },
  plugins: [
    // make sure to include the plugin!
    new VueLoaderPlugin()
  ],
  module: {
    rules: [
      {
        test: /\.vue$/,
        loader: 'vue-loader',
        options: {
          loaders: {
            js: 'babel-loader'
          }
        }
      },
      {
        test: /\.js$/,
        exclude: /node_modules(?![\\/]@maplat)/,
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
      },
      {
        test: /\.(jpg|jpeg|png)$/,
        exclude: /node_modules(?![\\/]@maplat)/,
        loader: 'file-loader',
        options: {
          outputPath: "images"
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
