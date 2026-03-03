# ⚙️ Installation & Setup

Follow these steps to get AtlasMind running on your local machine.

## 📋 Prerequisites

Ensure you have the following installed:
- **Node.js** 18+ and **npm**
- **MongoDB Atlas** Account ([Create one here](https://www.mongodb.com/cloud/atlas))
- **Groq API Key** ([Get it here](https://console.groq.com))

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/lakshmanbhukya/AtlasMind.git
cd AtlasMind
```

### 2. Backend Configuration
```bash
cd server
npm install
```

Create a `.env` file in the `server` directory:
```env
# MongoDB Atlas connection string
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<database>

# Groq Cloud API key
GROQ_API_KEY=your-groq-api-key-here

# Server configuration
PORT=3001
NODE_ENV=development
```

### 3. Frontend Configuration
```bash
cd ../client
npm install
```

### 4. Running the Application
We recommend using the root `start.bat` (Windows) or running separately:

**Start Backend:**
```bash
cd server
npm run dev
```

**Start Frontend:**
```bash
cd client
npm run dev
```

The application will be available at `http://localhost:5173`.

## 📂 Database Setup

### Seed Sample Data (Highly Recommended)
To explore the dual-panel analytics immediately, run the seeder:
```bash
cd server
npm run seed
```
This creates sample collections (sales, inventory, customers) with benchmark data.

## 🔑 Obtaining Credentials

### Groq API
1. Sign up at [Groq Console](https://console.groq.com).
2. Go to **API Keys** → **Create New Key**.

### MongoDB Atlas
1. Create a free cluster at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
2. **Network Access**: Add your IP (or `0.0.0.0/0` for dev).
3. **Database Access**: Create a user with `atlasAdmin` or `readWriteAnyDatabase` roles.
4. **Connect**: Copy the SRV connection string into your `.env`.

---
[⬅️ Back to README](../README.md)
