const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'quiz_master.db');

class Database {
    constructor() {
        this.db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
                console.error('Error opening database:', err.message);
            } else {
                console.log('✅ Connected to SQLite database');
                this.init();
            }
        });
    }

    init() {
        // Users table
        this.db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Quizzes table
        this.db.run(`CREATE TABLE IF NOT EXISTS quizzes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            time_limit INTEGER DEFAULT 10,
            user_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`);

        // Questions table
        this.db.run(`CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            quiz_id INTEGER NOT NULL,
            question_text TEXT NOT NULL,
            option_a TEXT NOT NULL,
            option_b TEXT NOT NULL,
            option_c TEXT,
            option_d TEXT,
            correct_answer INTEGER NOT NULL,
            question_order INTEGER NOT NULL,
            FOREIGN KEY (quiz_id) REFERENCES quizzes (id)
        )`);

        // Results table
        this.db.run(`CREATE TABLE IF NOT EXISTS quiz_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            quiz_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            score INTEGER NOT NULL,
            total_questions INTEGER NOT NULL,
            time_taken INTEGER NOT NULL,
            answers TEXT NOT NULL,
            completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (quiz_id) REFERENCES quizzes (id),
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`);

        // Add indexes for better performance
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_quizzes_user_id ON quizzes(user_id)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_questions_quiz_id ON questions(quiz_id)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_results_quiz_user ON quiz_results(quiz_id, user_id)`);
        
        console.log('✅ Database tables and indexes initialized');
    }

    // User methods
    createUser(username, email, password, callback) {
        const sql = `INSERT INTO users (username, email, password) VALUES (?, ?, ?)`;
        this.db.run(sql, [username, email, password], function(err) {
            callback(err, this.lastID);
        });
    }

    getUserByEmail(email, callback) {
        const sql = `SELECT * FROM users WHERE email = ?`;
        this.db.get(sql, [email], callback);
    }

    getUserById(id, callback) {
        const sql = `SELECT id, username, email, created_at FROM users WHERE id = ?`;
        this.db.get(sql, [id], callback);
    }

    // Quiz methods
    createQuiz(quizData, callback) {
        const { title, description, time_limit, user_id } = quizData;
        const sql = `INSERT INTO quizzes (title, description, time_limit, user_id) VALUES (?, ?, ?, ?)`;
        this.db.run(sql, [title, description, time_limit, user_id], function(err) {
            callback(err, this.lastID);
        });
    }

    getQuizzesByUser(userId, callback) {
        const sql = `SELECT * FROM quizzes WHERE user_id = ? ORDER BY created_at DESC`;
        this.db.all(sql, [userId], callback);
    }

    getQuizById(id, callback) {
        const sql = `SELECT * FROM quizzes WHERE id = ?`;
        this.db.get(sql, [id], (err, quiz) => {
            if (err || !quiz) {
                callback(err, null);
                return;
            }
            
            // Get questions for this quiz
            const questionsSql = `SELECT * FROM questions WHERE quiz_id = ? ORDER BY question_order`;
            this.db.all(questionsSql, [id], (err, questions) => {
                if (err) {
                    callback(err, null);
                    return;
                }
                
                // FIXED: Format questions with proper string options
                const formattedQuestions = questions.map(q => {
                    // Create options array from the individual option fields
                    const options = [
                        q.option_a,
                        q.option_b,
                        q.option_c,
                        q.option_d
                    ].filter(opt => opt !== null && opt !== undefined && opt !== '');
                    
                    return {
                        id: q.id,
                        text: q.question_text,
                        options: options, // Now this is an array of strings
                        correct: q.correct_answer
                    };
                });
                
                callback(null, { ...quiz, questions: formattedQuestions });
            });
        });
    }

    deleteQuiz(quizId, userId, callback) {
        // First delete questions
        const deleteQuestionsSql = `DELETE FROM questions WHERE quiz_id = ?`;
        this.db.run(deleteQuestionsSql, [quizId], (err) => {
            if (err) {
                callback(err);
                return;
            }
            
            // Then delete quiz
            const deleteQuizSql = `DELETE FROM quizzes WHERE id = ? AND user_id = ?`;
            this.db.run(deleteQuizSql, [quizId, userId], function(err) {
                callback(err, this.changes);
            });
        });
    }

    // Question methods
    addQuestion(questionData, callback) {
        const { quiz_id, question_text, option_a, option_b, option_c, option_d, correct_answer, question_order } = questionData;
        const sql = `INSERT INTO questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_answer, question_order) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        this.db.run(sql, [quiz_id, question_text, option_a, option_b, option_c, option_d, correct_answer, question_order], callback);
    }

    // Results methods
    saveResult(resultData, callback) {
        const { quiz_id, user_id, score, total_questions, time_taken, answers } = resultData;
        const sql = `INSERT INTO quiz_results (quiz_id, user_id, score, total_questions, time_taken, answers) 
                     VALUES (?, ?, ?, ?, ?, ?)`;
        this.db.run(sql, [quiz_id, user_id, score, total_questions, time_taken, JSON.stringify(answers)], function(err) {
            callback(err, this.lastID);
        });
    }

    getResultsByUser(userId, callback) {
        const sql = `
            SELECT qr.*, q.title as quiz_title 
            FROM quiz_results qr 
            JOIN quizzes q ON qr.quiz_id = q.id 
            WHERE qr.user_id = ? 
            ORDER BY qr.completed_at DESC
        `;
        this.db.all(sql, [userId], callback);
    }

    close() {
        this.db.close();
    }
}

module.exports = new Database();
