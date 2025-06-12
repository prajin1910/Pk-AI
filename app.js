const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const uri = "mongodb+srv://reksitrajan01:8n4SHiaJfCZRrimg@cluster0.mperr.mongodb.net/test?retryWrites=true&w=majority";
mongoose.connect(uri)
    .then(() => console.log('✅ MongoDB Connected Successfully!'))
    .catch((err) => {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    });

// User Schema
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Chat Schema
const chatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  messages: [{
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  }],
  title: { type: String, default: 'New Chat' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Chat = mongoose.model('Chat', chatSchema);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
  secret: 'your-secret-key-change-this-in-production',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: 'mongodb+srv://reksitrajan01:8n4SHiaJfCZRrimg@cluster0.mperr.mongodb.net/test?retryWrites=true&w=majority'
  }),
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Set EJS as templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware to check authentication
const requireAuth = (req, res, next) => {
  if (req.session.userId) {
    next();
  } else {
    res.redirect('/login');
  }
};

// Routes

// Home route - redirect to login or main page
app.get('/', (req, res) => {
  if (req.session.userId) {
    res.redirect('/chat');
  } else {
    res.redirect('/login');
  }
});

// Login page
app.get('/login', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/chat');
  }
  res.render('login', { error: null });
});

// Register page
app.get('/register', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/chat');
  }
  res.render('register', { error: null });
});

// Main chat page
app.get('/chat', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const chats = await Chat.find({ userId: req.session.userId }).sort({ updatedAt: -1 });
    res.render('mainpage', { user, chats });
  } catch (error) {
    console.error('Error loading chat page:', error);
    res.status(500).send('Server error');
  }
});
app.use(express.static(path.join(__dirname, 'public'))); 
// Profile page
app.get('/profile', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const chatCount = await Chat.countDocuments({ userId: req.session.userId });
        res.render('profile', { user, chatCount, success: null, error: null });
    } catch (error) {
        console.error('Error loading profile:', error);
        res.status(500).send('Server error');
    }
});

// Register POST
app.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.render('register', { error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      name,
      email,
      password: hashedPassword
    });

    await user.save();
    req.session.userId = user._id;
    res.redirect('/chat');
  } catch (error) {
    console.error('Registration error:', error);
    res.render('register', { error: 'Registration failed' });
  }
});

// Login POST
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.render('login', { error: 'Invalid email or password' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.render('login', { error: 'Invalid email or password' });
    }

    req.session.userId = user._id;
    res.redirect('/chat');
  } catch (error) {
    console.error('Login error:', error);
    res.render('login', { error: 'Login failed' });
  }
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Updated /api/chat route - BACKEND UPDATE
app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const { message, aiResponse, chatId } = req.body;
    
    let chat;
    if (chatId) {
      chat = await Chat.findOne({ _id: chatId, userId: req.session.userId });
    }
    
    if (!chat) {
      chat = new Chat({
        userId: req.session.userId,
        messages: [],
        title: message.length > 50 ? message.substring(0, 50) + '...' : message
      });
    }

    // Add user message
    chat.messages.push({
      role: 'user',
      content: message
    });

    // Add AI response
    chat.messages.push({
      role: 'assistant',
      content: aiResponse
    });
    
    chat.updatedAt = new Date();
    await chat.save();
    
    // FIXED: Return chat data for proper sidebar updates
    res.json({
      success: true,
      chatId: chat._id,
      chat: {
        _id: chat._id,
        title: chat.title,
        updatedAt: chat.updatedAt
      }
    });
    
  } catch (error) {
    console.error('Chat save error:', error);
    res.json({
      success: false,
      error: 'Failed to save chat'
    });
  }
});
// Get chat history
app.get('/api/chat/:chatId', requireAuth, async (req, res) => {
  try {
    const chat = await Chat.findOne({ 
      _id: req.params.chatId, 
      userId: req.session.userId 
    });
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    res.json(chat);
  } catch (error) {
    console.error('Error fetching chat:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete chat
app.delete('/api/chat/:chatId', requireAuth, async (req, res) => {
  try {
    await Chat.findOneAndDelete({ 
      _id: req.params.chatId, 
      userId: req.session.userId 
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting chat:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete account route - FIXED VERSION (add chatCount)
app.post('/delete-account', requireAuth, async (req, res) => {
  try {
    // Delete all user's chats
    await Chat.deleteMany({ userId: req.session.userId });
    
    // Delete user account
    await User.findByIdAndDelete(req.session.userId);
    
    // Destroy session
    req.session.destroy();
    
    res.redirect('/register?deleted=true');
  } catch (error) {
    console.error('Error deleting account:', error);
    const user = await User.findById(req.session.userId);
    const chatCount = await Chat.countDocuments({ userId: req.session.userId });
    res.render('profile', { 
      user,
      chatCount,
      error: 'Failed to delete account. Please try again.',
      success: null
    });
  }
});


app.post('/update-profile', requireAuth, async (req, res) => {
  try {
    const { name, email } = req.body;
    const currentUser = await User.findById(req.session.userId);
    const chatCount = await Chat.countDocuments({ userId: req.session.userId });
    
    // Check if email is being changed and if it already exists
    if (email !== currentUser.email) {
      const existingUser = await User.findOne({ email, _id: { $ne: req.session.userId } });
      if (existingUser) {
        return res.render('profile', { 
          user: currentUser,
          chatCount,
          error: 'Email already exists. Please use a different email.',
          success: null
        });
      }
    }
    
    // Update user
    const updatedUser = await User.findByIdAndUpdate(
      req.session.userId, 
      { name, email },
      { new: true } // Return updated document
    );
    
    res.render('profile', { 
      user: updatedUser,
      chatCount,
      success: 'Profile updated successfully!',
      error: null
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    const user = await User.findById(req.session.userId);
    const chatCount = await Chat.countDocuments({ userId: req.session.userId });
    res.render('profile', { 
      user,
      chatCount,
      error: 'Failed to update profile. Please try again.',
      success: null
    });
  }
});


// Change password route - FIXED VERSION
app.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;
    const user = await User.findById(req.session.userId);
    const chatCount = await Chat.countDocuments({ userId: req.session.userId });
    
    // Check if new passwords match
    if (newPassword !== confirmNewPassword) {
      return res.render('profile', { 
        user,
        chatCount,
        error: 'New passwords do not match. Please try again.',
        success: null
      });
    }
    
    // Check minimum password length
    if (newPassword.length < 6) {
      return res.render('profile', { 
        user,
        chatCount,
        error: 'New password must be at least 6 characters long.',
        success: null
      });
    }
    
    // Check current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.render('profile', { 
        user,
        chatCount,
        error: 'Current password is incorrect. Please try again.',
        success: null
      });
    }
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update password
    await User.findByIdAndUpdate(req.session.userId, {
      password: hashedPassword
    });
    
    res.render('profile', { 
      user,
      chatCount,
      success: 'Password changed successfully!',
      error: null
    });
  } catch (error) {
    console.error('Error changing password:', error);
    const user = await User.findById(req.session.userId);
    const chatCount = await Chat.countDocuments({ userId: req.session.userId });
    res.render('profile', { 
      user,
      chatCount,
      error: 'Failed to change password. Please try again.',
      success: null
    });
  }
});


// Chats page
app.get('/chats', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const chats = await Chat.find({ userId: req.session.userId }).sort({ updatedAt: -1 });
        res.render('chats', { user, chats, success: null, error: null });
    } catch (error) {
        console.error('Error loading chats page:', error);
        res.status(500).send('Server error');
    }
});
// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});