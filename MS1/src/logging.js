

function createLogger(context = "app") {

  function ts() {
    return new Date().toISOString();
  }

  return {
    debug: (msg) => {
      console.log(`[${ts()}] [DEBUG] [${context}] ${msg}`);
    },
    info: (msg) => {
      console.log(`[${ts()}] [INFO ] [${context}] ${msg}`);
    },
    warn: (msg) => {
      console.warn(`[${ts()}] [WARN ] [${context}] ${msg}`);
    },
    error: (msg) => {
      console.error(`[${ts()}] [ERROR] [${context}] ${msg}`);
    },
  };
}

module.exports = createLogger;