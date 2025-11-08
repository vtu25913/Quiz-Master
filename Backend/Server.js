const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'quiz-master-secret-key-2024';

// Database
const db = require('./database');

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

console.log('🚀 Starting Quiz Master Server...');

// Serve the main frontend application
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Health endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Quiz Master API is running',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// User Registration
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    try {
        // Check if user already exists
        db.getUserByEmail(email, (err, existingUser) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (existingUser) {
                return res.status(400).json({ error: 'User already exists' });
            }

            // Create new user
            bcrypt.hash(password, 10, (err, hashedPassword) => {
                if (err) {
                    console.error('Password hashing error:', err);
                    return res.status(500).json({ error: 'Server error' });
                }

                db.createUser(username, email, hashedPassword, (err, userId) => {
                    if (err) {
                        console.error('User creation error:', err);
                        return res.status(500).json({ error: 'Error creating user' });
                    }

                    const token = jwt.sign({ userId, username }, JWT_SECRET);
                    res.status(201).json({
                        message: 'User created successfully',
                        token,
                        user: { id: userId, username, email }
                    });
                });
            });
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// User Login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        db.getUserByEmail(email, async (err, user) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            if (!user) {
                return res.status(400).json({ error: 'Invalid credentials' });
            }

            try {
                const validPassword = await bcrypt.compare(password, user.password);
                if (!validPassword) {
                    return res.status(400).json({ error: 'Invalid credentials' });
                }

                const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET);
                res.json({
                    message: 'Login successful',
                    token,
                    user: { id: user.id, username: user.username, email: user.email }
                });
            } catch (error) {
                console.error('Password comparison error:', error);
                res.status(500).json({ error: 'Server error' });
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Get user's quizzes
app.get('/api/my-quizzes', authenticateToken, (req, res) => {
    db.getQuizzesByUser(req.user.userId, (err, quizzes) => {
        if (err) {
            console.error('Error fetching quizzes:', err);
            return res.status(500).json({ error: 'Failed to fetch quizzes' });
        }
        res.json(quizzes || []);
    });
});

// Create new quiz
app.post('/api/quizzes', authenticateToken, (req, res) => {
    const { title, description, timeLimit, questions } = req.body;
    const userId = req.user.userId;

    if (!title || !title.trim()) {
        return res.status(400).json({ error: 'Quiz title is required' });
    }

    if (!questions || questions.length === 0) {
        return res.status(400).json({ error: 'At least one question is required' });
    }

    // Create quiz
    db.createQuiz({
        title: title.trim(),
        description: description ? description.trim() : '',
        time_limit: timeLimit || 10,
        user_id: userId
    }, (err, quizId) => {
        if (err) {
            console.error('Error creating quiz:', err);
            return res.status(500).json({ error: 'Failed to create quiz' });
        }

        // Add questions - FIXED: Ensure options are properly stored
        let questionsAdded = 0;
        let hasError = false;

        questions.forEach((question, index) => {
            // FIXED: Extract option texts from the array
            const options = question.options || [];
            
            const questionData = {
                quiz_id: quizId,
                question_text: question.text,
                option_a: options[0] || '', // First option
                option_b: options[1] || '', // Second option
                option_c: options[2] || null, // Third option (optional)
                option_d: options[3] || null, // Fourth option (optional)
                correct_answer: question.correct,
                question_order: index
            };

            db.addQuestion(questionData, (err) => {
                if (err) {
                    console.error('Error adding question:', err);
                    hasError = true;
                }
                questionsAdded++;

                if (questionsAdded === questions.length) {
                    if (hasError) {
                        return res.status(500).json({ error: 'Some questions failed to save' });
                    }
                    res.status(201).json({
                        message: 'Quiz created successfully',
                        quizId: quizId
                    });
                }
            });
        });
    });
});

// Get single quiz
app.get('/api/quizzes/:id', authenticateToken, (req, res) => {
    const quizId = parseInt(req.params.id);
    
    db.getQuizById(quizId, (err, quiz) => {
        if (err) {
            console.error('Error fetching quiz:', err);
            return res.status(500).json({ error: 'Failed to fetch quiz' });
        }
        
        if (!quiz) {
            return res.status(404).json({ error: 'Quiz not found' });
        }

        res.json(quiz);
    });
});

// Save quiz results
app.post('/api/quiz-results', authenticateToken, (req, res) => {
    const { quizId, score, totalQuestions, timeTaken, answers } = req.body;
    const userId = req.user.userId;

    if (!quizId || score === undefined || !totalQuestions || !timeTaken) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    db.saveResult({
        quiz_id: quizId,
        user_id: userId,
        score,
        total_questions: totalQuestions,
        time_taken: timeTaken,
        answers: answers
    }, (err, resultId) => {
        if (err) {
            console.error('Error saving result:', err);
            return res.status(500).json({ error: 'Failed to save results' });
        }

        res.json({
            message: 'Results saved successfully',
            resultId: resultId
        });
    });
});

// Get user's quiz results
app.get('/api/my-results', authenticateToken, (req, res) => {
    db.getResultsByUser(req.user.userId, (err, results) => {
        if (err) {
            console.error('Error fetching results:', err);
            return res.status(500).json({ error: 'Failed to fetch results' });
        }
        res.json(results || []);
    });
});

// Delete quiz
app.delete('/api/quizzes/:id', authenticateToken, (req, res) => {
    const quizId = parseInt(req.params.id);
    const userId = req.user.userId;

    db.deleteQuiz(quizId, userId, (err, changes) => {
        if (err) {
            console.error('Error deleting quiz:', err);
            return res.status(500).json({ error: 'Failed to delete quiz' });
        }

        if (changes === 0) {
            return res.status(404).json({ error: 'Quiz not found or access denied' });
        }

        res.json({ message: 'Quiz deleted successfully' });
    });
});

// Add demo data on startup
function addDemoData() {
    const demoPassword = bcrypt.hashSync('password123', 10);
    
    // Demo user
    db.createUser('demo', 'demo@quizmaster.com', demoPassword, (err, userId) => {
        if (err && !err.message.includes('UNIQUE constraint failed')) {
            console.error('Error creating demo user:', err);
        } else {
            console.log('✅ Demo user created: demo@quizmaster.com / password123');
            
            // Create a demo quiz
            const demoQuiz = {
                title: 'Web Development Basics',
                description: 'Test your knowledge of HTML, CSS, and JavaScript fundamentals',
                time_limit: 10,
                user_id: userId
            };
            
            db.createQuiz(demoQuiz, (err, quizId) => {
                if (!err) {
                    // Add demo questions
                    const demoQuestions = [
                        {
                            quiz_id: quizId,
                            question_text: 'What does HTML stand for?',
                            option_a: 'Hyper Text Markup Language',
                            option_b: 'High Tech Modern Language',
                            option_c: 'Hyper Transfer Markup Language',
                            option_d: 'Home Tool Markup Language',
                            correct_answer: 0,
                            question_order: 0
                        },
                        {
                            quiz_id: quizId,
                            question_text: 'Which CSS property is used to change the text color?',
                            option_a: 'text-color',
                            option_b: 'color',
                            option_c: 'font-color',
                            option_d: 'text-style',
                            correct_answer: 1,
                            question_order: 1
                        },
                        {
                            quiz_id: quizId,
                            question_text: 'Which symbol is used for single-line comments in JavaScript?',
                            option_a: '//',
                            option_b: '/*',
                            option_c: '--',
                            option_d: '#',
                            correct_answer: 0,
                            question_order: 2
                        }
                    ];
                    
                    let questionsAdded = 0;
                    demoQuestions.forEach(q => {
                        db.addQuestion(q, (err) => {
                            if (!err) {
                                questionsAdded++;
                                if (questionsAdded === demoQuestions.length) {
                                    console.log('✅ Demo quiz created with sample questions');
                                }
                            }
                        });
                    });
                }
            });
        }
    });
}

// Global error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled Error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// Handle 404
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Add demo data on startup
setTimeout(addDemoData, 1000);

// Start server
app.listen(PORT, () => {
    console.log(`\n🎯 Quiz Master Server running on port ${PORT}`);
    console.log(`🌐 Frontend Application: http://localhost:${PORT}`);
    console.log(`🔗 API Health: http://localhost:${PORT}/api/health`);
    console.log(`\n📋 Demo Account:`);
    console.log(`   📧 Email: demo@quizmaster.com`);
    console.log(`   🔑 Password: password123`);
    console.log(`\n⏹️  Press Ctrl+C to stop the server\n`);
    
    // Display a nice ASCII art banner
    console.log(`
    ╔══════════════════════════════════════════════════════════════╗
    ║                                                              ║
    ║    🎯 Q U I Z   M A S T E R   S E R V E R   🎯              ║
    ║                                                              ║
    ║    Server successfully started! Ready for connections.       ║
    ║                                                              ║
    ╚══════════════════════════════════════════════════════════════╝
    `);
});

// Error handling
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});
