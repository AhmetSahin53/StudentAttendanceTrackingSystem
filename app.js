const express = require("express")
const mysql = require("mysql2")
const session = require("express-session")
const bcrypt = require("bcrypt")
const path = require("path")
const app = express()
const port = 4000

// Middleware setup
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(express.static(path.join(__dirname, "public")))
app.set("view engine", "ejs")
app.set("views", path.join(__dirname, "views"))

// Session setupc
app.use(
  session({
    secret: "firat-university-attendance-secret",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 3600000 }, // 1 hour
  }),
)

// Replace the database connection and table creation code with a simpler connection
// Database connection
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "sanane53",
  database: "attendance_system2",
  multipleStatements: true,
})

db.connect((err) => {
  if (err) {
    console.error("Database connection failed: " + err.stack)
    return
  }
  console.log("Connected to database")
})

// Authentication middleware
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    return next()
  }
  res.redirect("/login")
}

const isTeacher = (req, res, next) => {
  if (req.session.user && req.session.user.role === "teacher") {
    return next()
  }
  res.status(403).render("error", { message: "Yetkiniz yok" })
}

// Routes
app.get("/", (req, res) => {
  res.render("index", { user: req.session.user })
})

app.get("/login", (req, res) => {
  res.render("login", { error: null })
})

app.post("/login", (req, res) => {
  const { username, password } = req.body

  db.query("SELECT * FROM users WHERE username = ?", [username], async (err, results) => {
    if (err) throw err

    if (results.length === 0) {
      return res.render("login", { error: "Kullanıcı adı veya şifre hatalı" })
    }

    const user = results[0]
    const match = await bcrypt.compare(password, user.password)

    if (!match) {
      return res.render("login", { error: "Kullanıcı adı veya şifre hatalı" })
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
    }

    res.redirect("/dashboard")
  })
})

app.get("/register", (req, res) => {
  res.render("register", { error: null })
})

app.post("/register", async (req, res) => {
  const { username, password, fullName, role } = req.body

  try {
    const hashedPassword = await bcrypt.hash(password, 10)

    db.query(
      "INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)",
      [username, hashedPassword, fullName, role],
      (err) => {
        if (err) {
          if (err.code === "ER_DUP_ENTRY") {
            return res.render("register", { error: "Bu kullanıcı adı zaten kullanılıyor" })
          }
          throw err
        }

        res.redirect("/login")
      },
    )
  } catch (err) {
    res.render("register", { error: "Kayıt sırasında bir hata oluştu" })
  }
})

app.get("/dashboard", isAuthenticated, (req, res) => {
  const user = req.session.user

  if (user.role === "teacher") {
    // Get courses taught by the teacher
    db.query("SELECT * FROM courses WHERE teacher_id = ?", [user.id], (err, courses) => {
      if (err) throw err
      res.render("teacher-dashboard", { user, courses })
    })
  } else {
    // Get courses enrolled by the student
    db.query(
      `SELECT c.* FROM courses c
       JOIN enrollments e ON c.id = e.course_id
       WHERE e.student_id = ?`,
      [user.id],
      (err, courses) => {
        if (err) throw err
        res.render("student-dashboard", { user, courses })
      },
    )
  }
})

app.get("/courses", isAuthenticated, (req, res) => {
  db.query("SELECT * FROM courses", (err, courses) => {
    if (err) throw err
    res.render("courses", { user: req.session.user, courses })
  })
})

app.get("/course/:id", isAuthenticated, (req, res) => {
  const courseId = req.params.id
  const user = req.session.user

  db.query("SELECT * FROM courses WHERE id = ?", [courseId], (err, results) => {
    if (err) throw err

    if (results.length === 0) {
      return res.status(404).render("error", { message: "Kurs bulunamadı" })
    }

    const course = results[0]

    if (user.role === "teacher") {
      // Get all students enrolled in this course with their attendance
      db.query(
        `SELECT u.id, u.full_name, 
         (SELECT COUNT(*) FROM attendance a WHERE a.student_id = u.id AND a.course_id = ? AND a.status = 'present') as present_count
         FROM users u
         JOIN enrollments e ON u.id = e.student_id
         WHERE e.course_id = ? AND u.role = 'student'`,
        [courseId, courseId],
        (err, students) => {
          if (err) throw err
          res.render("course-details-teacher", { user, course, students })
        },
      )
    } else {
      // Get student's attendance for this course
      db.query(
        `SELECT a.date, a.status FROM attendance a
         WHERE a.student_id = ? AND a.course_id = ?`,
        [user.id, courseId],
        (err, attendance) => {
          if (err) throw err
          res.render("course-details-student", { user, course, attendance })
        },
      )
    }
  })
})

app.post("/enroll", isAuthenticated, (req, res) => {
  if (req.session.user.role !== "student") {
    return res.status(403).render("error", { message: "Sadece öğrenciler kursa kaydolabilir" })
  }

  const { courseId } = req.body
  const studentId = req.session.user.id

  db.query("INSERT INTO enrollments (student_id, course_id) VALUES (?, ?)", [studentId, courseId], (err) => {
    if (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(400).render("error", { message: "Bu kursa zaten kayıtlısınız" })
      }
      throw err
    }

    res.redirect("/dashboard")
  })
})

app.post("/mark-attendance", isAuthenticated, (req, res) => {
  if (req.session.user.role !== "student") {
    return res.status(403).render("error", { message: "Sadece öğrenciler yoklama alabilir" })
  }

  const { courseId } = req.body
  const studentId = req.session.user.id
  const today = new Date().toISOString().split("T")[0]

  db.query(
    'INSERT INTO attendance (student_id, course_id, date, status) VALUES (?, ?, ?, "present") ON DUPLICATE KEY UPDATE status = "present"',
    [studentId, courseId, today],
    (err) => {
      if (err) throw err
      res.redirect(`/course/${courseId}`)
    },
  )
})

app.get("/create-course", isTeacher, (req, res) => {
  res.render("create-course", { user: req.session.user, error: null })
})

app.post("/create-course", isTeacher, (req, res) => {
  const { courseCode, courseName } = req.body
  const teacherId = req.session.user.id

  db.query(
    "INSERT INTO courses (course_code, course_name, teacher_id) VALUES (?, ?, ?)",
    [courseCode, courseName, teacherId],
    (err) => {
      if (err) {
        if (err.code === "ER_DUP_ENTRY") {
          return res.render("create-course", {
            user: req.session.user,
            error: "Bu kurs kodu zaten kullanılıyor",
          })
        }
        throw err
      }

      res.redirect("/dashboard")
    },
  )
})

app.get("/attendance-report/:courseId", isTeacher, (req, res) => {
  const courseId = req.params.courseId

  db.query(`SELECT c.course_name FROM courses c WHERE c.id = ?`, [courseId], (err, courseResults) => {
    if (err) throw err

    if (courseResults.length === 0) {
      return res.status(404).render("error", { message: "Kurs bulunamadı" })
    }

    const course = courseResults[0]

    db.query(
      `SELECT u.full_name, a.date, a.status
         FROM attendance a
         JOIN users u ON a.student_id = u.id
         WHERE a.course_id = ?
         ORDER BY a.date DESC, u.full_name`,
      [courseId],
      (err, attendanceRecords) => {
        if (err) throw err

        res.render("attendance-report", {
          user: req.session.user,
          course,
          courseId,
          attendanceRecords,
        })
      },
    )
  })
})

app.get("/logout", (req, res) => {
  req.session.destroy()
  res.redirect("/login")
})

app.listen(port, () => {
  console.log(`Attendance system running on http://localhost:${port}`)
})
