# 🔧 Troubleshooting & Support

Common issues and how to resolve them.

## Common Issues

### ❌ MongoDB Connection Error
**Symptoms**: Backend fails to start or "Database connection timed out".
- **Check**: Is your IP whitelisted in Atlas? (Try adding `0.0.0.0/0` temporarily).
- **Check**: Is the `MONGODB_URI` correctly pasted in `.env`?

### ❌ Groq Rate Limits
**Symptoms**: AI responses take a long time or return 429 errors.
- **Cause**: The free tier of Groq has strict RPM (Requests Per Minute) limits.
- **Solution**: Reduce query frequency or wait 60 seconds.

### ❌ MQL Execution Error
**Symptoms**: AI responds but says "Query failed to execute".
- **Solution**: This usually happens if the AI targets a field that doesn't exist. Refresh the **Schema Profiler** in the sidebar.

## 🐞 Support & Feedback

For bug reports or feature requests, please use the [GitHub Issues](https://github.com/lakshmanbhukya/AtlasMind/issues) page.

---
[⬅️ Back to README](../README.md)
