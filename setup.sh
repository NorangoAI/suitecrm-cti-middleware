#!/bin/bash

# CTI Middleware Setup Script

echo "========================================="
echo "CTI Middleware Setup"
echo "========================================="
echo ""

# Check Node.js version
echo "Checking Node.js version..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version must be 18 or higher. Current version: $(node -v)"
    exit 1
fi
echo "✓ Node.js version: $(node -v)"
echo ""

# Install dependencies
echo "Installing dependencies..."
npm install
if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi
echo "✓ Dependencies installed"
echo ""

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "Creating .env file..."
    cat > .env << 'EOF'
# Server Configuration
NODE_ENV=development
PORT=3000
WS_PORT=3001

# FreePBX/Asterisk AMI Configuration
AMI_HOST=localhost
AMI_PORT=5038
AMI_USERNAME=admin
AMI_SECRET=your_ami_secret

# ElevenLabs Webhook Configuration
ELEVENLABS_WEBHOOK_SECRET=your_elevenlabs_webhook_secret

# SuiteCRM API Configuration
SUITECRM_URL=https://your-suitecrm.com
SUITECRM_CLIENT_ID=your_client_id
SUITECRM_CLIENT_SECRET=your_client_secret
SUITECRM_USERNAME=admin
SUITECRM_PASSWORD=your_password

# Security Configuration
API_KEY=your_secure_api_key
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001

# Logging Configuration
LOG_LEVEL=info
LOG_DIR=./logs
EOF
    echo "✓ .env file created"
    echo ""
    echo "⚠️  IMPORTANT: Please edit .env file and update all credentials!"
    echo ""
else
    echo "✓ .env file already exists"
    echo ""
fi

# Create logs directory
if [ ! -d logs ]; then
    mkdir logs
    echo "✓ Created logs directory"
else
    echo "✓ Logs directory exists"
fi
echo ""

# Display next steps
echo "========================================="
echo "Setup Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. Edit .env file with your credentials:"
echo "   nano .env"
echo ""
echo "2. Configure FreePBX AMI access"
echo "3. Set up SuiteCRM OAuth2 credentials"
echo "4. Configure ElevenLabs webhook secret"
echo ""
echo "5. Start the server:"
echo "   npm start"
echo ""
echo "For Docker deployment:"
echo "   docker-compose up -d"
echo ""
echo "========================================="

