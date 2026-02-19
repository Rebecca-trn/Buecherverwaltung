
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const createLogger = require("./logging");
const logger = createLogger("db");
const dbPath = path.join(__dirname, "..", "books.db");
logger.info("SQLite DB-Datei:", dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    logger.info("DB-Fehler:", err.message);
    return;
  }

 logger.info("Connected to SQLite database");
  db.run("PRAGMA foreign_keys = ON;");

  db.serialize(() => {

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
        UNIQUE(title, publisher_id),
        FOREIGN KEY (author_id)    REFERENCES authors(id)    ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (publisher_id) REFERENCES publishers(id) ON UPDATE CASCADE ON DELETE RESTRICT
      )
    `);

  
   db.all("PRAGMA table_info(books);", (e, cols) => {
  if (e) {
    logger.error(`PRAGMA table_info Fehler: ${e.message}`);
    return;
  }

  const colNames = cols.map(c => c.name);
  const looksOld =
    colNames.includes("author") || colNames.includes("publisher");

  if (looksOld && (!colNames.includes("author_id") || !colNames.includes("publisher_id"))) {
    logger.warn("Altes books-Schema erkannt. Starte Migration...");
        db.exec("BEGIN TRANSACTION;", (e1) => {
          if (e1) return logger.info("BEGIN Fehler:", e1.message);

          // 1) Autoren/Verlage aus alten TEXT-Spalten erzeugen
        
          db.run(`
            INSERT OR IGNORE INTO authors(name)
            SELECT DISTINCT author FROM books WHERE author IS NOT NULL AND TRIM(author) <> ''
          `, (e2) => {
            if (e2) return rollback("authors füllen", e2);

            db.run(`
              INSERT OR IGNORE INTO publishers(name)
              SELECT DISTINCT publisher FROM books WHERE publisher IS NOT NULL AND TRIM(publisher) <> ''
            `, (e3) => {
              if (e3) return rollback("publishers füllen", e3);

              // 2) Neue Zieltabelle erstellen
              db.run(`
                CREATE TABLE IF NOT EXISTS books_new (
                  id           INTEGER PRIMARY KEY AUTOINCREMENT,
                  title        TEXT    NOT NULL,
                  author_id    INTEGER NOT NULL,
                  publisher_id INTEGER NOT NULL,
                  UNIQUE(title, publisher_id),
                  FOREIGN KEY (author_id)    REFERENCES authors(id)    ON UPDATE CASCADE ON DELETE RESTRICT,
                  FOREIGN KEY (publisher_id) REFERENCES publishers(id) ON UPDATE CASCADE ON DELETE RESTRICT
                )
              `, (e4) => {
                if (e4) return rollback("books_new anlegen", e4);

                // 3) Daten aus alter Tabelle in neue mappen (per Namen → IDs)
                db.run(`
                  INSERT INTO books_new (id, title, author_id, publisher_id)
                  SELECT  b.id,
                          b.title,
                          a.id AS author_id,
                          p.id AS publisher_id
                  FROM books b
                  LEFT JOIN authors   a ON a.name = b.author
                  LEFT JOIN publishers p ON p.name = b.publisher
                `, (e5) => {
                  if (e5) return rollback("Daten migrieren", e5);

                  // 4) Alte Tabelle umbenennen, neue übernehmen
                  db.run(`ALTER TABLE books RENAME TO books_old`, (e6) => {
                    if (e6) return rollback("books umbenennen", e6);

                    db.run(`ALTER TABLE books_new RENAME TO books`, (e7) => {
                      if (e7) return rollback("books_new umbenennen", e7);

                      // 5) Alte Tabelle entfernen
                      db.run(`DROP TABLE IF EXISTS books_old`, (e8) => {
                        if (e8) return rollback("books_old droppen", e8);

                        db.exec("COMMIT;", (e9) => {
                          if (e9) return logger.info("COMMIT Fehler:", e9.message);
                          logger.info("Migration abgeschlossen.");
                          logColumns();
                          seedIfEmpty();
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });

        function rollback(step, err) {
          logger.info(`Migration Fehler bei "${step}":`, err.message);
          db.exec("ROLLBACK;", (rbErr) => rbErr && logger.info("ROLLBACK Fehler:", rbErr.message));
        }
      } else {
 
        logColumns();
        seedIfEmpty();
      }
    });

    function logColumns() {
      db.all("PRAGMA table_info(books);", (e, list) => {
        if (!e) logger.info("books-Spalten:", list.map(c => c.name).join(", "));
      });
    }
  db.all("PRAGMA table_info(authors);", (eA, colsA) => {
  if (!eA) {
    const names = colsA.map(c => c.name);
    if (!names.includes("birth_year")) {
      db.run("ALTER TABLE authors ADD COLUMN birth_year INTEGER", err =>
        err && logger.warn("Spalte authors.birth_year nicht hinzugefügt:", err.message)
      );
    }
  }
});
db.all("PRAGMA table_info(publishers);", (e, cols) => {
  if (!e) {
    const names = cols.map(c => c.name);
    if (!names.includes("city")) {
      db.run("ALTER TABLE publishers ADD COLUMN city TEXT", err =>
        err && logger.warn("Spalte publishers.city nicht hinzugefügt:", err.message)
      );
    }
  }
});

    function seedIfEmpty() {
      db.get("SELECT COUNT(*) AS c FROM authors", (e, r) => {
        if (!e && r && r.c === 0) {
          const a = db.prepare("INSERT INTO authors (name) VALUES (?)");
          ["Robert C. Martin", "Kyle Simpson", "Marijn Haverbeke"].forEach(n => a.run(n));
          a.finalize();
        }
      });
      db.get("SELECT COUNT(*) AS c FROM publishers", (e, r) => {
        if (!e && r && r.c === 0) {
          const p = db.prepare("INSERT INTO publishers (name) VALUES (?)");
          ["Prentice Hall", "O'Reilly", "No Starch Press"].forEach(n => p.run(n));
          p.finalize();
        }
      });
      db.get("SELECT COUNT(*) AS c FROM books", (e, r) => {
        if (!e && r && r.c === 0) {
          db.all("SELECT id, name FROM authors", (e1, aa) => {
            db.all("SELECT id, name FROM publishers", (e2, pp) => {
              if (e1 || e2) return;
              const findId = (arr, name) => (arr.find(x => x.name === name) || {}).id;
              const rows = [
                { title: "Clean Code",           author: "Robert C. Martin", publisher: "Prentice Hall" },
                { title: "You Don't Know JS",    author: "Kyle Simpson",      publisher: "O'Reilly" },
                { title: "Eloquent JavaScript",  author: "Marijn Haverbeke",  publisher: "No Starch Press" },
              ];
              const ins = db.prepare("INSERT INTO books (title, author_id, publisher_id) VALUES (?,?,?)");
              rows.forEach(rw => {
                const aid = findId(aa, rw.author);
                const pid = findId(pp, rw.publisher);
                if (aid && pid) ins.run(rw.title, aid, pid);
              });
              ins.finalize();
            });
          });
        }
      });
    }
  });
});

module.exports = db;


