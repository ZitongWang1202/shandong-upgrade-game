module.exports = {
    resolve: {
      fallback: {
        "http": require.resolve("stream-http"),
        "path": require.resolve("path-browserify"),
        "url": require.resolve("url/"),
        "crypto": require.resolve("crypto-browserify"),
        "zlib": require.resolve("browserify-zlib"),
        "stream": require.resolve("stream-browserify"),
        "querystring": require.resolve("querystring-es3"),
        "timers": require.resolve("timers-browserify")
      }
    }
  };