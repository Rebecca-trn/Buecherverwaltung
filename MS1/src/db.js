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
        check ( year between 1000 and 9999 ),
        UNIQUE(title, publisher_id),
        FOREIGN KEY (author_id)    REFERENCES authors(id)    ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY (publisher_id) REFERENCES publishers(id) ON UPDATE CASCADE ON DELETE RESTRICT
      )
    `);
// schema anpassen

db.all("PRAGMA table_info(books);", (e, cols) => {
  if (e) {
    logger.error(`PRAGMA table_info Fehler: ${e.message}`);
    return;
  }

  const colNames = cols.map(c => c.name);
  const looksOld = colNames.includes("author") || colNames.includes("publisher");

 
  const missingIsbn = !colNames.includes("isbn");
  const missingYear = !colNames.includes("year");

  if (missingIsbn || missingYear) {
    logger.warn("books: isbn/year fehlen – füge Spalten via ALTER TABLE hinzu …");

    if (missingIsbn) {
      db.run(`ALTER TABLE books ADD COLUMN isbn TEXT`, (err) => {
        if (err) logger.error("ALTER TABLE add isbn fehlgeschlagen:", err.message);
        else logger.info("Spalte isbn hinzugefügt.");
      });
    }

    if (missingYear) {
      db.run(`ALTER TABLE books ADD COLUMN year INTEGER`, (err) => {
        if (err) logger.error("ALTER TABLE add year fehlgeschlagen:", err.message);
        else logger.info("Spalte year hinzugefügt.");
      });
    }


    db.run(
      `UPDATE books
         SET isbn = 'TEMP-' || id
       WHERE isbn IS NULL OR TRIM(COALESCE(isbn,'')) = ''`,
      (err) => {
        if (err) logger.error("isbn Defaults setzen fehlgeschlagen:", err.message);
      }
    );
    db.run(
      `UPDATE books
     SET year = MIN(
       MAX(CAST(year AS INTEGER), 1000),
       CAST(strftime('%Y','now') AS INTEGER)
     )
   WHERE year IS NULL
      OR CAST(year AS INTEGER) < 1000
      OR CAST(year AS INTEGER) > CAST(strftime('%Y','now') AS INTEGER)
`, (e3) => { 
  if (e3) return rollback("year normalisieren", e3);
 });

    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_books_isbn ON books(isbn)`,
      (err) => {
        if (err) logger.error("Index auf isbn erstellen fehlgeschlagen:", err.message);
      }
    );
  }

  
  if (looksOld && (!colNames.includes("author_id") || !colNames.includes("publisher_id"))) {
    logger.warn("Altes books-Schema erkannt. Starte Migration...");

    migrateOldSchema(() => {
      logColumns();
      seedIfEmpty();
      ensureDemoData();
    });

  } else {
    logColumns();
    seedIfEmpty();
    ensureDemoData();
  }
});

// Migration von altem Schema zu neuem Schema

    function migrateOldSchema(callback) {
      db.exec("BEGIN TRANSACTION;", (e1) => {
        if (e1) {
          logger.info("BEGIN Fehler:", e1.message);
          return;
        }

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

            db.run(`
              CREATE TABLE IF NOT EXISTS books_new (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                title        TEXT    NOT NULL,
                author_id    INTEGER NOT NULL,
                publisher_id INTEGER NOT NULL,
                isbn TEXT NOT NULL UNIQUE,
                year INTEGER NOT NULL,
                check ( year between 1000 and 9999 and year <= CAST(strftime('%Y', 'now') AS INTEGER )),
                UNIQUE(title, publisher_id),
                FOREIGN KEY (author_id)    REFERENCES authors(id)    ON UPDATE CASCADE ON DELETE RESTRICT,
                FOREIGN KEY (publisher_id) REFERENCES publishers(id) ON UPDATE CASCADE ON DELETE RESTRICT
              )
            `, (e4) => {
              if (e4) return rollback("books_new anlegen", e4);

              db.run(`
                INSERT INTO books_new (id, title, author_id, publisher_id, isbn, year)
                SELECT  b.id,
                        b.title,
                        a.id AS author_id,
                        p.id AS publisher_id,
                        b.isbn,
                        b.year
                FROM books b
                LEFT JOIN authors   a ON a.name = b.author
                LEFT JOIN publishers p ON p.name = b.publisher
                WHERE b.isbn IS NOT NULL AND b.year IS NOT NULL
              `, (e5) => {
                if (e5) return rollback("Daten migrieren", e5);

                db.run(`ALTER TABLE books RENAME TO books_old`, (e6) => {
                  if (e6) return rollback("books umbenennen", e6);

                  db.run(`ALTER TABLE books_new RENAME TO books`, (e7) => {
                    if (e7) return rollback("books_new umbenennen", e7);

                    db.run(`DROP TABLE IF EXISTS books_old`, (e8) => {
                      if (e8) return rollback("books_old droppen", e8);

                      db.exec("COMMIT;", (e9) => {
                        if (e9) return logger.info("COMMIT Fehler:", e9.message);
                        logger.info("Migration abgeschlossen.");
                        callback();
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    };


    function rollback(step, err) {
      logger.info(`Migration Fehler bei "${step}":`, err.message);
      db.exec("ROLLBACK;", (rbErr) =>
        rbErr && logger.info("ROLLBACK Fehler:", rbErr.message)
      );
    }

// Hilfsfunktionen

    function logColumns() {
      db.all("PRAGMA table_info(books);", (e, list) => {
        if (!e) logger.info("books-Spalten:", list.map(c => c.name).join(", "));
      });
    }


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
                { title: "Clean Code",           author: "Robert C. Martin", publisher: "Prentice Hall", isbn: "978-3-8266-5548-7", year: 2009},
                { title: "Wenn Sie wüsste",    author: "Freida McFadden",      publisher: "Heyne", isbn: "978-3-453-47190-0", year: 2023},
                { title: "The Defender",  author: "Ana Huang",  publisher: "Lyx", isbn: "978-3-7363-2571-5", year: 2026}
              ];

              const ins = db.prepare("INSERT INTO books (title, author_id, publisher_id, isbn, year) VALUES (?,?,?,?,?)");
              rows.forEach(rw => {
                const aid = findId(aa, rw.author);
                const pid = findId(pp, rw.publisher);
                if (aid && pid) ins.run(rw.title, aid, pid, rw.isbn, rw.year);
              });
              ins.finalize();
            });
          });
        }
      });
    }


    function ensureDemoData() {
      // Autoren ergänzen
      const insertAuthor = db.prepare("INSERT OR IGNORE INTO authors (name) VALUES (?)");
      ["Robert C. Martin", "Freida McFadden", "Ana Huang"].forEach(n => insertAuthor.run(n));
      insertAuthor.finalize();


    // Verlage ergänzen 
      const insertPublisher = db.prepare("INSERT OR IGNORE INTO publishers (name) VALUES (?)");
      ["Prentice Hall", "Heyne", "Lyx"].forEach(n => insertPublisher.run(n));
      insertPublisher.finalize();

      db.all("SELECT id, name FROM authors", (e1, aa) => {
        db.all("SELECT id, name FROM publishers", (e2, pp) => {
          if (e1 || e2) return;

          const findId = (arr, name) => (arr.find(x => x.name === name) || {}).id;

          const rows = [
            { title: "Clean Code",           author: "Robert C. Martin", publisher: "Prentice Hall", isbn: "978-3-8266-5548-7", year: 2009},
            { title: "Wenn Sie wüsste",    author: "Freida McFadden",      publisher: "Heyne", isbn: "978-3-453-47190-0", year: 2023},
            { title: "The Defender",  author: "Ana Huang",  publisher: "Lyx", isbn: "978-3-7363-2571-5", year: 2026}
          ];

          const insertBook = db.prepare(`
            INSERT OR IGNORE INTO books (title, author_id, publisher_id, isbn, year) VALUES (?,?,?,?,?)
          `);

          rows.forEach(rw => {
            const aid = findId(aa, rw.author);
            const pid = findId(pp, rw.publisher);
            if (aid && pid) insertBook.run(rw.title, aid, pid, rw.isbn, rw.year);
          });
          insertBook.finalize();
        });
      });
    }

  });
});

module.exports = db;
