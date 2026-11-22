const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

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

/* ------------------------------------------------------------------ */
/* Data (kept in memory - resets every time the server restarts)       */
/* ------------------------------------------------------------------ */

let students = [
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

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Student Information System API",
    storage: "memory",
    studentsInMemory: students.length,
    message: "Running without a database. Data resets when the server restarts.",
  });
});

// Get all students
app.get("/api/students", (req, res) => {
  const sorted = [...students].sort((a, b) =>
    a.studentId.localeCompare(b.studentId)
  );

  res.json(sorted);
});

// Get one student
app.get("/api/students/:studentId", (req, res) => {
  const student = students.find(
    (item) => item.studentId === req.params.studentId
  );

  if (!student) {
    return res.status(404).json({ message: "Student not found." });
  }

  res.json(student);
});

// Add a student
app.post("/api/students", (req, res) => {
  const studentId = clean(req.body.studentId);
  const name = clean(req.body.name);

  if (!studentId || !name) {
    return res.status(400).json({
      message: "Student ID and name are required.",
    });
  }

  if (students.some((item) => item.studentId === studentId)) {
    return res.status(409).json({
      message: "A student with this Student ID already exists.",
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

  const student = {
    studentId,
    name,
    email: clean(req.body.email),
    course: clean(req.body.course),
    yearLevel: clean(req.body.yearLevel),
    section: clean(req.body.section),
    status,
    contact: clean(req.body.contact),
    subjects: subjects || [],
  };

  students.push(student);

  console.log(
    "Student added -> studentId:", student.studentId,
    "| name:", student.name,
    "| course:", student.course,
    "| yearLevel:", student.yearLevel
  );

  res.status(201).json(student);
});

// Edit a student (partial updates are allowed)
app.put("/api/students/:studentId", (req, res) => {
  const index = students.findIndex(
    (item) => item.studentId === req.params.studentId
  );

  if (index === -1) {
    return res.status(404).json({ message: "Student not found." });
  }

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

  const updated = { ...students[index] };

  for (const field of UPDATABLE_FIELDS) {
    if (req.body[field] !== undefined) {
      updated[field] = clean(req.body[field]);
    }
  }

  if (subjects !== undefined) {
    updated.subjects = subjects;
  }

  students[index] = updated;

  console.log(
    "Student edited -> studentId:", updated.studentId,
    "| name:", updated.name,
    "| course:", updated.course,
    "| yearLevel:", updated.yearLevel
  );

  res.json(updated);
});

// Delete a student
app.delete("/api/students/:studentId", (req, res) => {
  const index = students.findIndex(
    (item) => item.studentId === req.params.studentId
  );

  if (index === -1) {
    return res.status(404).json({ message: "Student not found." });
  }

  const deleted = students.splice(index, 1)[0];

  console.log("Student deleted -> studentId:", deleted.studentId);

  res.json({ message: "Student deleted.", student: deleted });
});

app.use("/api", (req, res) => {
  res.status(404).json({
    message: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

app.listen(PORT, () => {
  console.log("===================================");
  console.log("Student Information System server is running!");
  console.log(`Server URL: http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`Students API: http://localhost:${PORT}/api/students`);
  console.log("Storage: memory (no database)");
  console.log("===================================");
});