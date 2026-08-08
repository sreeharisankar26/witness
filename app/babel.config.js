// Required by Metro. Without it, JSX and TypeScript are not transformed and the
// bundler fails before it reaches any of our code.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
