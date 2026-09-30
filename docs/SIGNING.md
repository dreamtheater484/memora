# Signing the desktop app

For maintainers. Windows and macOS trust apps that are **signed**: a certificate says who made the app, and that nobody changed it since. Unsigned, the app works the same, but the first start needs an extra step ([DESKTOP.md](DESKTOP.md#installing)), and on macOS the app can't update itself.

Everything for signing is ready in the release workflow: it signs as soon as the secrets below are set in GitHub (**Settings → Secrets and variables → Actions**). Nothing else changes. Only a release (a version tag) uses them: a pull request's dry run never sees them, and builds the Mac app signed ad hoc, as an unsigned release is. Getting the certificates needs your identity, and on macOS a paid membership, so that part is yours.

| System  | What it takes                                                                                                                                                                | Cost       |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Windows | The [Microsoft Store](#windows-the-microsoft-store): Microsoft signs Store apps itself. Or [SignPath Foundation](#windows-signpath-foundation) for the download from GitHub. | Free       |
| macOS   | The [Apple Developer Program](#macos-the-apple-developer-program)                                                                                                            | $99 a year |
| Ubuntu  | Nothing: Ubuntu doesn't ask for signed apps                                                                                                                                  | —          |

## Windows: the Microsoft Store

The Store is free for individual developers: no fee and no credit card, only an identity check with an ID and a selfie. Apps from the Store install without any warning and update through the Store.

1. Sign up as an **individual developer** at [storedeveloper.microsoft.com](https://storedeveloper.microsoft.com).
2. In **Partner Center**, reserve the name **Memora** for a new app.
3. Under **Product identity**, note three values, and add them in GitHub as repository **variables** (not secrets; they're public anyway):

   | Partner Center                          | GitHub variable               |
   | --------------------------------------- | ----------------------------- |
   | Package/Identity/Name                   | `MEMORA_STORE_IDENTITY`       |
   | Package/Identity/Publisher              | `MEMORA_STORE_PUBLISHER`      |
   | Package/Properties/PublisherDisplayName | `MEMORA_STORE_PUBLISHER_NAME` |

4. From the next release on, the Windows job also makes `Memora-Store.appx`. It isn't attached to the release; it's in the workflow run's artifacts, as **microsoft-store-package**.
5. In Partner Center, create a submission, upload `Memora-Store.appx`, and fill in the listing (description, screenshots from `docs/images`, the privacy statement from [DESKTOP.md](DESKTOP.md#privacy)). Microsoft reviews it, usually within a few days.

For later releases, upload the new package in a new submission. The download on GitHub stays unsigned; the download page can then point Windows users to the Store.

## Windows: SignPath Foundation

[SignPath Foundation](https://signpath.org) signs open-source projects for free, with its own certificate: Windows then shows "SignPath Foundation" as the publisher. The project applies once ([conditions](https://signpath.org/terms.html)): an open-source licence (Memora's MIT is fine), a published code-signing policy, and two-factor sign-in on GitHub. Signing then happens through SignPath's GitHub action, a step to add after the Windows build in the release workflow.

## Windows: other options

- **A code-signing certificate** from a certificate authority, about €100–300 a year. Since 2023 their keys live on a hardware token or in the authority's cloud, not in a file, so most need the authority's own signing tool in the workflow. The workflow does take a certificate file where one is available: secrets `WIN_CERTIFICATE` (the `.pfx`, base64) and `WIN_CERTIFICATE_PASSWORD`.
- **Azure Artifact Signing** (about $10 a month) takes individual developers from the United States and Canada only. Where it's available: secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET`, and variables `MEMORA_AZURE_ENDPOINT`, `MEMORA_AZURE_ACCOUNT`, `MEMORA_AZURE_PROFILE` and `MEMORA_AZURE_PUBLISHER`.

## macOS: the Apple Developer Program

The only way to a Mac app that opens without a warning, and updates itself.

1. Join the [Apple Developer Program](https://developer.apple.com/programs/) as an individual, $99 a year.
2. In Xcode (**Settings → Accounts → Manage Certificates**) or on the developer website, create a **Developer ID Application** certificate. Export it from Keychain Access as a `.p12` file with a password.
3. Create an **app-specific password** for your Apple Account at [account.apple.com](https://account.apple.com) (**Sign-In and Security → App-Specific Passwords**), and note your **Team ID** (on the developer website, under Membership).
4. Add these secrets in GitHub:

   | Secret                        | What                                             |
   | ----------------------------- | ------------------------------------------------ |
   | `MAC_CERTIFICATE`             | The `.p12` file, as base64: `base64 -i cert.p12` |
   | `MAC_CERTIFICATE_PASSWORD`    | Its password                                     |
   | `APPLE_ID`                    | The email of your Apple Account                  |
   | `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password                        |
   | `APPLE_TEAM_ID`               | Your Team ID                                     |

From the next release on, the Mac app is signed, notarised by Apple, and updates itself. The workflow checks the signature (`codesign --verify`) before testing the app.

## Checking a release

The release workflow shows what it did in the **Build the installers** step: electron-builder names the certificate it signed with, or says it skipped signing. On a computer:

- **Windows:** right-click `Memora-Setup.exe` → **Properties → Digital Signatures**.
- **macOS:** `spctl --assess --verbose /Applications/Memora.app` answers `accepted` and `source=Notarized Developer ID`.
