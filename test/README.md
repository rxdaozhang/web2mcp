# Simple Flask Email Server

A simple Flask web application with three pages: login, home, and starred.

## Features

- **Login Page** (`/login`): Accepts credentials "example@example.com" and "password123"
- **Home Page** (`/home`): Shows a navbar with Home and Starred buttons, displays three email boxes
- **Starred Page** (`/starred`): Same navbar as home but only shows one email (Email 1: You owe a bill)

## Setup and Running

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Run the server:**
   ```bash
   python app.py
   ```

3. **Access the application:**
   - Open your browser and go to `http://localhost:8000`
   - You'll be redirected to the login page
   - Use the credentials: `example@example.com` / `password123`

## Pages

### Login Page (`/login`)
- Simple login form with email and password fields
- Accepts only the specified credentials
- Shows error message for invalid credentials

### Home Page (`/home`)
- Navigation bar with Home, Starred, and Logout buttons
- Displays three email boxes:
  - Email 1: You owe a bill
  - Email 2: Meeting reminder
  - Email 3: Project update

### Starred Page (`/starred`)
- Same navigation bar as home page
- Shows only Email 1: You owe a bill

## File Structure

```
test/
├── app.py              # Main Flask application
├── requirements.txt    # Python dependencies
├── README.md          # This file
└── templates/         # HTML templates
    ├── login.html     # Login page template
    ├── home.html      # Home page template
    └── starred.html   # Starred page template
```
