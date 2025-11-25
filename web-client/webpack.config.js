const path = require('path');

module.exports = {
  mode: 'development',
  entry: './js/app.js',
  output: {
    filename: 'main.js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,
  },
  resolve: {
    extensions: ['.js', '.json'],
    alias: {
        'ice': path.resolve(__dirname, 'node_modules/ice/src/Ice/Ice.js'),
    },
    // --- AQUÍ ESTÁ LA SOLUCIÓN A LOS ERRORES ROJOS ---
    fallback: {
      "fs": false,
      "net": false,
      "tls": false,
      "child_process": false,
      "dgram": false
    }
  },
  module: {
    exprContextCritical: false, // Silencia la alerta de dependencia crítica
    rules: [
      {
        test: /\.js$/,
        type: 'javascript/auto',
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', { modules: 'commonjs' }]
            ]
          },
        },
      },
    ],
  },
  devServer: {
    static: {
      directory: path.join(__dirname, './'),
    },
    compress: true,
    port: 8080,
    hot: true,
  },
  ignoreWarnings: [/Failed to parse source map/, /Critical dependency/],
};