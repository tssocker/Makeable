# Deployment Anleitung

## 🚀 Web App auf Railway deployen

### Schritt 1: GitHub Repository erstellen

```bash
# Im Makeable Ordner
cd /Users/till/Makeable

# GitHub CLI auth
gh auth login
# Folge den Anweisungen im Browser

# Repository erstellen
gh repo create Makeable --public --source=. --remote=origin --push
```

### Schritt 2: Railway Deployment

1. Gehe zu [railway.app](https://railway.app)
2. Klicke auf "Start a New Project"
3. Wähle "Deploy from GitHub repo"
4. Wähle dein "Makeable" Repository
5. Füge Environment Variables hinzu:
   - `ANTHROPIC_API_KEY` = dein Anthropic API Key
   - `JWT_SECRET` = ein zufälliger String (z.B. generiere mit `openssl rand -base64 32`)
   - `PORT` = 3000

6. Klicke auf "Deploy"

### Schritt 3: Domain bekommen

Nach dem Deployment:
- Railway gibt dir automatisch eine URL (z.B. `makeable-production.up.railway.app`)
- Diese URL ist **permanent** und funktioniert immer!

### Schritt 4: URL in iOS App eintragen

Öffne `/Users/till/MakeableApp/App.tsx` und ändere:

```typescript
const WEB_APP_URL = 'https://deine-railway-url.up.railway.app';
```

---

## 📱 iOS App im Simulator testen

```bash
cd /Users/till/MakeableApp
npx react-native run-ios
```

Oder öffne in Xcode:
```bash
cd /Users/till/MakeableApp
xed ios/MakeableApp.xcworkspace
```

Dann CMD + R zum Starten!

---

## 📲 iOS App im App Store veröffentlichen

### Voraussetzungen:
- Apple Developer Account ($99/Jahr)
- Xcode installiert

### Schritte:

1. **Bundle ID ändern**
   - Öffne `ios/MakeableApp.xcworkspace` in Xcode
   - Wähle das Projekt in der linken Sidebar
   - Unter "Signing & Capabilities":
     - Bundle Identifier: `com.deinname.makeable`
     - Team: Wähle dein Apple Developer Team

2. **App Icons hinzufügen**
   - Gehe zu `ios/MakeableApp/Images.xcassets/AppIcon.appiconset`
   - Füge App Icons in verschiedenen Größen hinzu (1024x1024, 60x60, etc.)

3. **Version & Build Number setzen**
   - In Xcode unter "General":
     - Version: 1.0
     - Build: 1

4. **Archive erstellen**
   - In Xcode: Product → Archive
   - Warte bis Archiv fertig ist

5. **Zu App Store Connect hochladen**
   - Window → Organizer
   - Wähle dein Archiv
   - Klicke "Distribute App"
   - Wähle "App Store Connect"
   - Folge den Anweisungen

6. **App Store Connect konfigurieren**
   - Gehe zu [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
   - Erstelle neue App
   - Fülle alle Infos aus (Screenshots, Beschreibung, etc.)
   - Reiche App zur Review ein

---

## 🎨 App Icons generieren

Du kannst App Icons automatisch generieren mit:
- [AppIcon.co](https://appicon.co)
- [MakeAppIcon.com](https://makeappicon.com)

Einfach dein 1024x1024 Logo hochladen!

---

## ⚡ Quick Start nach der Rückkehr

1. **Server starten:**
   ```bash
   cd /Users/till/Makeable
   npm run dev
   ```

2. **iOS App im Simulator:**
   ```bash
   cd /Users/till/MakeableApp
   npx react-native run-ios
   ```

3. **Xcode öffnen:**
   ```bash
   xed /Users/till/MakeableApp/ios/MakeableApp.xcworkspace
   ```

Fertig! 🎉
