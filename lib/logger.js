const pino = require('pino');

// Create a logging instance
// const logger = pino({
//   level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
// });
const logger = {
  info: (...args) => {console.log(...args)}
};

module.exports.logger = logger;
