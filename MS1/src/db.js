const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const createLogger = require("./logging");

const logger = createLogger("db");
const dbPath = path.join(__dirname, "..", "books.db");
let publishEventCallback = null;
let mqttReady = false;

logger.info("SQLite DB-Datei:", dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    logger.info("DB-Fehler:", err.message);
    return;
  }

  logger.info("Connected to SQLite database");

  db.run("PRAGMA foreign_keys = ON;");
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA synchronous = NORMAL;");
  db.run("PRAGMA busy_timeout = 5000;");

  db.serialize(() => {

    // Tabellen anlegen
    db.run(`
      CREATE TABLE IF NOT EXISTS authors (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS publishers (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS books (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        title        TEXT    NOT NULL,
        author_id    INTEGER NOT NULL,
        publisher_id INTEGER NOT NULL,
        isbn TEXT NOT NULL UNIQUE,
        year INTEGER NOT NULL,
        CHECK (year BETWEEN 1000 AND 9999),
        UNIQUE(title, publisher_id),
        FOREIGN KEY (author_id)    REFERENCES authors(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (publisher_id) REFERENCES publishers(id) ON UPDATE CASCADE ON DELETE RESTRICT
      )
    `);

    // Spalten anzeigen
    db.all("PRAGMA table_info(books);", (e, cols) => {
      if (e) {
        logger.error(`PRAGMA table_info Fehler: ${e.message}`);
        return;
      }

      logger.info("books-Spalten:", cols.map(c => c.name).join(", "));
      // Warte auf MQTT-Verbindung, bevor Demo-Daten geladen werden
      if (mqttReady) {
        ensureDemoData();
      }
    });
  });
});


function ensureDemoData() {
  // Autoren
  const authors = ["Robert C. Martin", "Freida McFadden", "Ana Huang"];
  let authorCount = 0;

  authors.forEach(a => {
    logger.info("Insert Author:", a);
    db.run("INSERT OR IGNORE INTO authors(name) VALUES (?)", [a], function(err) {
      if (!err && this.lastID) {
        if (publishEventCallback) publishEventCallback("authors", this.lastID, "created");
      }
      authorCount++;
      if (authorCount === authors.length) {
        insertPublishers();
      }
    });
  });
}

function insertPublishers() {
  // Verlage
  const publishers = ["Prentice Hall", "Heyne", "Lyx"];
  let pubCount = 0;

  publishers.forEach(p => {
    logger.info("Insert Publisher:", p);
    db.run("INSERT OR IGNORE INTO publishers(name) VALUES (?)", [p], function(err) {
      if (!err && this.lastID) {
        if (publishEventCallback) publishEventCallback("publishers", this.lastID, "created");
      }
      pubCount++;
      if (pubCount === publishers.length) {
        insertBooks();
      }
    });
  });
}

function insertBooks() {
  // Bücher
  db.all("SELECT id, name FROM authors", (e1, aa) => {
    db.all("SELECT id, name FROM publishers", (e2, pp) => {
      if (e1 || e2) return;

      const findId = (arr, name) => (arr.find(x => x.name === name) || {}).id;

      const books = [
        { title: "Clean Code",       author: "Robert C. Martin", publisher: "Prentice Hall", isbn: "978-3-8266-5548-7", year: 2009 },
        { title: "Wenn Sie wüsste",  author: "Freida McFadden", publisher: "Heyne",          isbn: "978-3-453-47190-0", year: 2023 },
        { title: "The Defender",     author: "Ana Huang",        publisher: "Lyx",           isbn: "978-3-7363-2571-5", year: 2026 }
      ];

      books.forEach(b => {
        const aid = findId(aa, b.author);
        const pid = findId(pp, b.publisher);
        logger.info("Insert book:", b.title, "Author ID:", aid, "Publisher ID:", pid);
        if (aid && pid) {
          db.run(
            "INSERT OR IGNORE INTO books (title, author_id, publisher_id, isbn, year) VALUES (?,?,?,?,?)",
            [b.title, aid, pid, b.isbn, b.year],
            function(err) {
              if (!err && this.lastID && this.changes > 0) {
                if (publishEventCallback) {
                  publishEventCallback("books", this.lastID, "created");
                }
              }
            }
          );
        }
      });
    });
  });
}

module.exports = db;
module.exports.onReady = (callback) => {
  // Rufe den Callback sofort auf (db wird synchron erzeugt)
  callback();
};
module.exports.setPublishEventCallback = (callback) => {
  publishEventCallback = callback;
};
module.exports.setMqttReady = () => {
  mqttReady = true;
  // Laden Sie Demo-Daten, wenn DB bereit ist
  db.all("PRAGMA table_info(books);", (e, cols) => {
    if (!e && cols && publishEventCallback) {
      ensureDemoData();
    }
  });
};