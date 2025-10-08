# Makeable iOS App

## Setup in Xcode

1. Öffne Xcode
2. File → New → Project
3. Wähle "App" unter iOS
4. Product Name: **MakeableApp**
5. Organization Identifier: **com.makeable**
6. Interface: **SwiftUI**
7. Language: **Swift**
8. Speichere in: `/Users/till/Makeable/ios/MakeableApp`

## Dann ersetze die Dateien mit den generierten Files hier:

- `ContentView.swift` → Hauptansicht
- `MakeableAPI.swift` → Backend-Integration
- `Models.swift` → Datenmodelle

## Backend URL anpassen

In `MakeableAPI.swift` ändere die `baseURL`:
```swift
private let baseURL = "http://192.168.0.150:3000"
```

## Features

✨ Native iOS UI mit SwiftUI
🎨 Makeable Design (Pink, Orange, Purple)
🔐 Login/Register
📱 Projekt-Liste & Preview
✏️ App-Generierung
