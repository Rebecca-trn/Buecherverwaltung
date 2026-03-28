const createLoggerFromPkg = require("logging").default;

const levels = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

function createLogger(context = "app") {
  const pkgLogger = createLoggerFromPkg(context);
  let activeLevel = process.env.LOG_LEVEL || "info";

  function shouldLog(level) {
    return levels[level] >= levels[activeLevel];
  }

  return {
    debug: (...args) => {
      if (shouldLog("debug")) pkgLogger.debug(...args);
    },
    info: (...args) => {
      if (shouldLog("info")) pkgLogger.info(...args);
    },
    warn: (...args) => {
      if (shouldLog("warn")) pkgLogger.warn(...args);
    },
    error: (...args) => {
      if (shouldLog("error")) pkgLogger.error(...args);
    },
    setLevel: (level) => {
      if (!Object.prototype.hasOwnProperty.call(levels, level)) {
        throw new Error(`Ungültiges Log-Level: ${level}. Erlaubt: ${Object.keys(levels).join(", ")}`);
      }
      activeLevel = level;
    },
    getLevel: () => activeLevel
  };
}

module.exports = createLogger;