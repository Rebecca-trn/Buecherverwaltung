const express = require("express");
const router = express.Router();
const db = require("../db");

// Get books 
router.get("/", (req, res) => {
  const sendError = req.app.locals.sendError;
  const q = (req.query.q || "").trim();

  const baseSql = `
    SELECT b.id, b.title,
           a.name AS author,
           p.name AS publisher,
           b.isbn,
           b.year
    FROM books b
    JOIN authors a    ON a.id = b.author_id
    JOIN publishers p ON p.id = b.publisher_id
  `;

  if (!q) {
    db.all(baseSql + " ORDER BY b.id", [], (err, rows) => {
      if (err) return sendError(res, 500, err.message);
      res.json(rows);
    });
  } else {
    const like = `%${q}%`;
    db.all(
      baseSql + `
        WHERE LOWER(b.title) LIKE LOWER(?)
           OR LOWER(a.name)  LIKE LOWER(?)
           OR LOWER(p.name)  LIKE LOWER(?)
        ORDER BY b.id
      `,
      [like, like, like],
      (err, rows) => {
        if (err) return sendError(res, 500, err.message);
        res.json(rows);
      }
    );
  }
});

//Get book by id
router.get("/:id", (req, res) => {
  const sendError = req.app.locals.sendError;

  db.get(
    `
    SELECT b.id, b.title,
           a.name AS author,
           p.name AS publisher,
           b.isbn,
           b.year
    FROM books b
    JOIN authors a    ON a.id = b.author_id
    JOIN publishers p ON p.id = b.publisher_id
    WHERE b.id = ?
    `,
    [req.params.id],
    (err, row) => {
      if (err) return sendError(res, 500, err.message);
      if (!row) return sendError(res, 404, "Buch nicht gefunden");
      res.json(row);
    }
  );
});

// post books
router.post("/", (req, res) => {
  const sendError = req.app.locals.sendError;
  const publishEvent = req.app.locals.publishEvent;
  const getOrCreateIdByName = req.app.locals.getOrCreateIdByName;

  const { title, author, publisher, isbn, year } = req.body;
  if (!title || !author || !publisher || !isbn || year == null) {
    return sendError(res, 400, "title, author, publisher, isbn und year sind Pflichtfelder");
  }

  const currentYear = new Date().getFullYear();
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1000 || y > currentYear) {
    return sendError(res, 400, `year muss eine 4-stellige Jahreszahl zwischen 1000 und ${currentYear} sein`);
  }

  getOrCreateIdByName("authors", author, (eA, author_id) => {
    if (eA) return sendError(res, 500, eA.message);

    getOrCreateIdByName("publishers", publisher, (eP, publisher_id) => {
      if (eP) return sendError(res, 500, eP.message);

      db.run(
        "INSERT INTO books (title, author_id, publisher_id, isbn, year) VALUES (?,?,?,?,?)",
        [title, author_id, publisher_id, isbn, year ],
        function (err) {
          
          if (err) {
  if (String(err.message).includes("UNIQUE") && String(err.message).includes("isbn")) {
    return sendError(res, 409, "ISBN existiert bereits");
  }
  return sendError(res, 500, err.message);
}
          db.get(
            `SELECT b.id, b.title, a.name AS author, p.name AS publisher, b.isbn, b.year
             FROM books b
             JOIN authors a ON a.id = b.author_id
             JOIN publishers p ON p.id = b.publisher_id
             WHERE b.id = ?`,
            [this.lastID],
            (err2, row) => {
              if (err2) return sendError(res, 500, err2.message);

              publishEvent("books", row.id, "created");
              res.status(201).json(row);
            }
          );
        }
      );
    });
  });
});

//patch book by id
router.patch("/:id", (req, res) => {
  const sendError = req.app.locals.sendError;
  const publishEvent = req.app.locals.publishEvent;
  const getOrCreateIdByName = req.app.locals.getOrCreateIdByName;

  const allowed = ["title", "author", "publisher", "isbn", "year"];
  const body = {};
  for (const k of allowed)
    if (Object.prototype.hasOwnProperty.call(req.body, k)) body[k] = req.body[k];

  if (Object.keys(body).length === 0)
    return sendError(res, 400, "Keine gültigen Felder zum Aktualisieren");

  const out = { title: body.title };
  if (Object.prototype.hasOwnProperty.call(body, "isbn")) out.isbn = body.isbn;
  if (Object.prototype.hasOwnProperty.call(body, "year")) out.year = body.year; 

  const doUpdate = (fields) => {
    const sets = [];
    const params = [];

    if (fields.title) { sets.push("title = ?"); params.push(fields.title); }
    if (fields.author_id) { sets.push("author_id = ?"); params.push(fields.author_id); }
    if (fields.publisher_id) { sets.push("publisher_id = ?"); params.push(fields.publisher_id); }
    if (fields.isbn) { sets.push("isbn = ?"); params.push(fields.isbn); }
    if (fields.year) { sets.push("year = ?"); params.push(fields.year); }

    params.push(req.params.id);

    db.run(`UPDATE books SET ${sets.join(", ")} WHERE id = ?`, params, function (err) {
      
      if (err) {
  if (String(err.message).includes("UNIQUE") && String(err.message).includes("isbn")) {
    return sendError(res, 409, "ISBN existiert bereits");
  }
  return sendError(res, 500, err.message);
}
     if (this.changes === 0) return sendError(res, 404, "Buch nicht gefunden");

      db.get(
        `SELECT b.id, b.title, a.name AS author, p.name AS publisher, b.isbn, b.year  
         FROM books b
         JOIN authors a ON a.id = b.author_id
         JOIN publishers p ON p.id = b.publisher_id
         WHERE b.id = ?`,
        [req.params.id],
        (err2, row) => {
          if (err2) return sendError(res, 500, err2.message);

          publishEvent("books", row.id, "updated");
          res.json(row);
        }
      );
    });
  };

  const nextForPublisher = () => {
    if (!body.publisher) return doUpdate(out);
    getOrCreateIdByName("publishers", body.publisher, (eP, pid) => {
      if (eP) return sendError(res, 500, eP.message);
      out.publisher_id = pid;
      doUpdate(out);
    });
  };

  if (!body.author) return nextForPublisher();

  getOrCreateIdByName("authors", body.author, (eA, aid) => {
    if (eA) return sendError(res, 500, eA.message);
    out.author_id = aid;
    nextForPublisher();
  });
});

// delete book by id
router.delete("/:id", (req, res) => {
  const sendError = req.app.locals.sendError;
  const publishEvent = req.app.locals.publishEvent;

  db.run("DELETE FROM books WHERE id = ?", [req.params.id], function (err) {
    if (err) return sendError(res, 500, err.message);
    if (this.changes === 0) return sendError(res, 404, "Buch nicht gefunden");

    publishEvent("books", Number(req.params.id), "deleted");
    res.status(204).send();
  });
});

module.exports = router;