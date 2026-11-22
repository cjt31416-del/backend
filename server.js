const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
const PORT = process.env.PORT || 8080;
// Database settings. On your computer (XAMPP) the defaults below are used.
// On Render, set these as Environment Variables instead:
// DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_SSL
const DB_NAME = process.env.DB_NAME || "student_information_db";

const DB_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
};

// Most hosted MySQL services require an SSL connection.
if (process.env.DB_SSL === "true") {
  DB_CONFIG.ssl = { rejectUnauthorized: false };
}

const ALLOWED_STATUSES = ["Active", "Inactive"];
const UPDATABLE_FIELDS = [
  "name",
  "email",
  "course",
  "yearLevel",
  "section",
  "status",
  "contact",
];

app.use(cors());
app.use(express.json());

let pool;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function clean(value) {
  return String(value ?? "").trim();
}

// Validates and normalizes a list of subjects coming from the request body.
// Returns { subjects } on success (subjects is undefined when not provided)
// or { error } when the data is invalid.
function normalizeSubjects(input) {
  if (input === undefined) return { subjects: undefined };

  if (!Array.isArray(input)) {
    return { error: "Subjects must be a list." };
  }

  const subjects = [];

  for (const item of input) {
    const code = clean(item && item.code);
    const name = clean(item && item.name);
    const hasUnits = item && item.units !== undefined && item.units !== "";
    const units = hasUnits ? Number(item.units) : 0;

    if (!code || !name) {
      return { error: "Each subject needs a code and a name." };
    }

    if (!Number.isInteger(units) || units < 0) {
      return { error: "Subject units must be a whole, non-negative number." };
    }

    subjects.push({
      code,
      name,
      units,
      schedule: clean(item.schedule),
      grade: clean(item.grade),
    });
  }

  return { subjects };
}

async function insertSubjects(db, studentId, subjects) {
  if (!subjects || subjects.length === 0) return;

  const rows = subjects.map((subject) => [
    studentId,
    subject.code,
    subject.name,
    subject.units,
    subject.schedule,
    subject.grade,
  ]);

  await db.query(
    "INSERT INTO subjects (studentId, code, name, units, schedule, grade) VALUES ?",
    [rows]
  );
}

// Adds a `subjects` array to each student row.
async function attachSubjects(students, db = pool) {
  if (students.length === 0) return students;

  const ids = students.map((student) => student.studentId);

  const [subjectRows] = await db.query(
    `SELECT studentId, code, name, units, schedule, grade
     FROM subjects
     WHERE studentId IN (?)
     ORDER BY id`,
    [ids]
  );

  const byStudent = {};
  for (const row of subjectRows) {
    const { studentId, ...subject } = row;
    if (!byStudent[studentId]) byStudent[studentId] = [];
    byStudent[studentId].push(subject);
  }

  return students.map((student) => ({
    ...student,
    subjects: byStudent[student.studentId] || [],
  }));
}

async function getStudent(studentId, db = pool) {
  const [rows] = await db.query(
    "SELECT * FROM students WHERE studentId = ?",
    [studentId]
  );

  if (!rows.length) return null;

  const [student] = await attachSubjects(rows, db);
  return student;
}

/* ------------------------------------------------------------------ */
/* Database setup                                                      */
/* ------------------------------------------------------------------ */

async function seedSampleData() {
  const samples = [
    {
      studentId: "2026-0001",
      name: "Juan Dela Cruz",
      email: "juan@example.com",
      course: "BS Information Technology",
      yearLevel: "1st Year",
      section: "A",
      status: "Active",
      contact: "09171234567",
      subjects: [
        { code: "IT101", name: "Introduction to Computing", units: 3, schedule: "Mon 8:00 AM", grade: "1.50" },
        { code: "CC101", name: "Computer Programming 1", units: 3, schedule: "Tue 9:00 AM", grade: "1.75" },
      ],
    },
    {
      studentId: "2026-0002",
      name: "Maria Santos",
      email: "maria@example.com",
      course: "BS Computer Science",
      yearLevel: "2nd Year",
      section: "B",
      status: "Active",
      contact: "09181234567",
      subjects: [
        { code: "CS201", name: "Data Structures", units: 3, schedule: "Wed 10:00 AM", grade: "1.25" },
      ],
    },
    {
      studentId: "2026-0003",
      name: "Pedro Reyes",
      email: "pedro@example.com",
      course: "BS Business Administration",
      yearLevel: "3rd Year",
      section: "A",
      status: "Inactive",
      contact: "09191234567",
      subjects: [],
    },
  ];

  for (const sample of samples) {
    await pool.query(
      `INSERT INTO students
       (studentId, name, email, course, yearLevel, section, status, contact)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sample.studentId,
        sample.name,
        sample.email,
        sample.course,
        sample.yearLevel,
        sample.section,
        sample.status,
        sample.contact,
      ]
    );

    await insertSubjects(pool, sample.studentId, sample.subjects);
  }

  console.log("Sample students added to the new database.");
}

async function initializeDatabase() {
  const connection = await mysql.createConnection(DB_CONFIG);

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`;`);
  } catch (error) {
    // Some hosted databases do not allow creating databases. That is fine
    // as long as the database in DB_NAME already exists.
    console.warn("Could not create database (continuing):", error.message);
  } finally {
    await connection.end();
  }

  pool = mysql.createPool({
    ...DB_CONFIG,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  // Used to add sample data only the very first time the table is created.
  const [existingTable] = await pool.query("SHOW TABLES LIKE 'students'");
  const isFirstRun = existingTable.length === 0;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS students (
      studentId VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) DEFAULT '',
      course VARCHAR(255) DEFAULT '',
      yearLevel VARCHAR(50) DEFAULT '',
      section VARCHAR(50) DEFAULT '',
      status VARCHAR(20) DEFAULT 'Active',
      contact VARCHAR(50) DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subjects (
      id INT AUTO_INCREMENT PRIMARY KEY,
      studentId VARCHAR(50) NOT NULL,
      code VARCHAR(50) NOT NULL,
      name VARCHAR(255) NOT NULL,
      units INT DEFAULT 0,
      schedule VARCHAR(100) DEFAULT '',
      grade VARCHAR(20) DEFAULT '',
      FOREIGN KEY (studentId) REFERENCES students(studentId)
        ON DELETE CASCADE
        ON UPDATE CASCADE
    );
  `);

  // Adds any missing columns if the table was created by an older version.
  const alterQueries = [
    "ALTER TABLE students ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL DEFAULT ''",
    "ALTER TABLE students ADD COLUMN IF NOT EXISTS email VARCHAR(255) DEFAULT ''",
    "ALTER TABLE students ADD COLUMN IF NOT EXISTS course VARCHAR(255) DEFAULT ''",
    "ALTER TABLE students ADD COLUMN IF NOT EXISTS yearLevel VARCHAR(50) DEFAULT ''",
    "ALTER TABLE students ADD COLUMN IF NOT EXISTS section VARCHAR(50) DEFAULT ''",
    "ALTER TABLE students ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active'",
    "ALTER TABLE students ADD COLUMN IF NOT EXISTS contact VARCHAR(50) DEFAULT ''",
  ];

  for (const query of alterQueries) {
    try {
      await pool.query(query);
    } catch (e) {
      // Column already exists or the syntax is not supported - safe to ignore.
    }
  }

  if (isFirstRun) {
    await seedSampleData();
  }

  console.log(
    `Database '${DB_NAME}' with tables 'students' and 'subjects' is ready!`
  );
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    const [[{ total }]] = await pool.query(
      "SELECT COUNT(*) AS total FROM students"
    );

    res.json({
      status: "ok",
      service: "Student Information System API",
      storage: "MySQL",
      database: DB_NAME,
      studentsInDatabase: total,
      message: "API and MySQL are connected.",
    });
  } catch (error) {
    console.error("Database connection error:", error.message);
    res.status(500).json({ message: "Database connection failed." });
  }
});

// Get all students
app.get("/api/students", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM students ORDER BY studentId"
    );

    res.json(await attachSubjects(rows));
  } catch (error) {
    console.error("Fetch students error:", error.message);
    res.status(500).json({ message: "Failed to fetch students." });
  }
});

// Get one student
app.get("/api/students/:studentId", async (req, res) => {
  try {
    const student = await getStudent(req.params.studentId);

    if (!student) {
      return res.status(404).json({ message: "Student not found." });
    }

    res.json(student);
  } catch (error) {
    console.error("Get student error:", error.message);
    res.status(500).json({ message: "Failed to fetch student." });
  }
});

// Add a student
app.post("/api/students", async (req, res) => {
  const studentId = clean(req.body.studentId);
  const name = clean(req.body.name);

  if (!studentId || !name) {
    return res.status(400).json({
      message: "Student ID and name are required.",
    });
  }

  const status = clean(req.body.status) || "Active";

  if (!ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({
      message: "Status must be Active or Inactive.",
    });
  }

  const { subjects, error: subjectsError } = normalizeSubjects(
    req.body.subjects
  );

  if (subjectsError) {
    return res.status(400).json({ message: subjectsError });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.query(
      `INSERT INTO students
       (studentId, name, email, course, yearLevel, section, status, contact)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        studentId,
        name,
        clean(req.body.email),
        clean(req.body.course),
        clean(req.body.yearLevel),
        clean(req.body.section),
        status,
        clean(req.body.contact),
      ]
    );

    await insertSubjects(connection, studentId, subjects);
    await connection.commit();

    const student = await getStudent(studentId, connection);

    console.log(
      "Student added -> studentId:", student.studentId,
      "| name:", student.name,
      "| course:", student.course,
      "| yearLevel:", student.yearLevel
    );

    res.status(201).json(student);
  } catch (error) {
    await connection.rollback().catch(() => {});

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "A student with this Student ID already exists.",
      });
    }

    console.error("Add student error:", error.message);
    res.status(500).json({ message: "Failed to save student." });
  } finally {
    connection.release();
  }
});

// Edit a student (partial updates are allowed)
app.put("/api/students/:studentId", async (req, res) => {
  const { studentId } = req.params;

  if (req.body.name !== undefined && !clean(req.body.name)) {
    return res.status(400).json({ message: "Name cannot be empty." });
  }

  if (
    req.body.status !== undefined &&
    !ALLOWED_STATUSES.includes(clean(req.body.status))
  ) {
    return res.status(400).json({
      message: "Status must be Active or Inactive.",
    });
  }

  const { subjects, error: subjectsError } = normalizeSubjects(
    req.body.subjects
  );

  if (subjectsError) {
    return res.status(400).json({ message: subjectsError });
  }

  const connection = await pool.getConnection();

  try {
    const existing = await getStudent(studentId, connection);

    if (!existing) {
      return res.status(404).json({ message: "Student not found." });
    }

    const sets = [];
    const values = [];

    for (const field of UPDATABLE_FIELDS) {
      if (req.body[field] !== undefined) {
        sets.push(`\`${field}\` = ?`);
        values.push(clean(req.body[field]));
      }
    }

    await connection.beginTransaction();

    if (sets.length > 0) {
      await connection.query(
        `UPDATE students SET ${sets.join(", ")} WHERE studentId = ?`,
        [...values, studentId]
      );
    }

    if (subjects !== undefined) {
      await connection.query("DELETE FROM subjects WHERE studentId = ?", [
        studentId,
      ]);
      await insertSubjects(connection, studentId, subjects);
    }

    await connection.commit();

    const updated = await getStudent(studentId, connection);

    console.log(
      "Student edited -> studentId:", updated.studentId,
      "| name:", updated.name,
      "| course:", updated.course,
      "| yearLevel:", updated.yearLevel
    );

    res.json(updated);
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error("Update student error:", error.message);
    res.status(500).json({ message: "Failed to update student." });
  } finally {
    connection.release();
  }
});

// Delete a student (their subjects are removed automatically)
app.delete("/api/students/:studentId", async (req, res) => {
  try {
    const student = await getStudent(req.params.studentId);

    if (!student) {
      return res.status(404).json({ message: "Student not found." });
    }

    const [result] = await pool.query(
      "DELETE FROM students WHERE studentId = ?",
      [req.params.studentId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: "Student not found." });
    }

    console.log(
      "Student deleted from MySQL -> studentId:", student.studentId,
      "| database:", DB_NAME,
      "| rows removed:", result.affectedRows
    );

    res.json({ message: "Student deleted.", student });
  } catch (error) {
    console.error("Delete student error:", error.message);
    res.status(500).json({ message: "Failed to delete student." });
  }
});

app.use("/api", (req, res) => {
  res.status(404).json({
    message: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

async function startServer() {
  try {
    await initializeDatabase();

    app.listen(PORT, () => {
      console.log("===================================");
      console.log("Student Information System server is running!");
      console.log(`Server URL: http://localhost:${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
      console.log(`Students API: http://localhost:${PORT}/api/students`);
      console.log(`MySQL database: ${DB_NAME}`);
      console.log("===================================");
    });
  } catch (error) {
    console.error(
      "Cannot connect to MySQL:",
      error.code || "",
      error.message || ""
    );
    console.error(
      `Tried host: ${DB_CONFIG.host}:${DB_CONFIG.port} | user: ${DB_CONFIG.user} | database: ${DB_NAME}`
    );
    console.error(
      "Check that MySQL is running and that the DB_* settings are correct."
    );
    process.exit(1);
  }
}

startServer();