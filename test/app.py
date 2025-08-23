from flask import Flask, render_template, request, redirect, url_for, session
from functools import wraps

app = Flask(__name__)
app.secret_key = 'your-secret-key-here'  # Required for session management

# Login required decorator
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/')
def index():
    return redirect(url_for('login'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        
        if email == 'example@example.com' and password == 'password123':
            session['logged_in'] = True
            return redirect(url_for('home'))
        else:
            return render_template('login.html', error='Invalid credentials')
    
    return render_template('login.html')

@app.route('/home')
@login_required
def home():
    # Get emails from session or use default
    all_emails = session.get('emails', [
        {'id': 1, 'subject': 'You owe a bill', 'content': 'Please pay your outstanding balance of $150.00 by the end of this month.'},
        {'id': 2, 'subject': 'Meeting reminder', 'content': 'Don\'t forget about the team meeting tomorrow at 2 PM in Conference Room A.'},
        {'id': 3, 'subject': 'Project update', 'content': 'The quarterly project review has been scheduled for next Friday. Please prepare your reports.'}
    ])
    
    # Get search query from URL parameters
    search_query = request.args.get('search', '').strip()
    
    # Filter emails if search query is provided
    if search_query:
        search_lower = search_query.lower()
        emails = [
            email for email in all_emails 
            if search_lower in email['subject'].lower() or search_lower in email['content'].lower()
        ]
    else:
        emails = all_emails
    
    return render_template('home.html', emails=emails, search_query=search_query)

@app.route('/compose_email', methods=['POST'])
@login_required
def compose_email():
    subject = request.form.get('subject', '').strip()
    body = request.form.get('body', '').strip()
    
    if subject and body:
        # Get current emails from session
        emails = session.get('emails', [
            {'id': 1, 'subject': 'You owe a bill', 'content': 'Please pay your outstanding balance of $150.00 by the end of this month.'},
            {'id': 2, 'subject': 'Meeting reminder', 'content': 'Don\'t forget about the team meeting tomorrow at 2 PM in Conference Room A.'},
            {'id': 3, 'subject': 'Project update', 'content': 'The quarterly project review has been scheduled for next Friday. Please prepare your reports.'}
        ])
        
        # Find the next available ID
        next_id = max([email['id'] for email in emails]) + 1 if emails else 1
        
        # Add new email to the list
        new_email = {
            'id': next_id,
            'subject': subject,
            'content': body
        }
        emails.append(new_email)
        
        # Save back to session
        session['emails'] = emails
    
    return redirect(url_for('home'))

@app.route('/starred')
@login_required
def starred():
    # Only show the first email (Email 1: You owe a bill)
    emails = [
        {'id': 1, 'subject': 'You owe a bill', 'content': 'Please pay your outstanding balance of $150.00 by the end of this month.'}
    ]
    return render_template('starred.html', emails=emails)

@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login'))

if __name__ == '__main__':
    app.run(debug=True, port=8000, host='0.0.0.0')
