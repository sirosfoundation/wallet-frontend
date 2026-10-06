<p align="center">A fork of <a href="https://github.com/wwWallet/wallet-frontend" target="_blank" rel="noopener">wwWallet frontend</a></p>

---

<img src="./branding/default/logo/logo_dark.svg" width="80" style="max-width: 100%; float:left; margin-right: 20px;"/>

# wwWallet

![Greek (EL) Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/wwWallet/wallet-frontend/master/translation_coverage/coverage_el.json)
![Portuguese (PT) Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/wwWallet/wallet-frontend/master/translation_coverage/coverage_pt.json)

Welcome to wwWallet Frontend repository! This application is a user-friendly web wallet that empowers users to manage their digital credentials effortlessly. With a seamless interface and powerful features, users can view their credentials, obtain new ones from issuers, present credentials to verifiers, and access their presentation history.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Pre-commit Hook](#pre-commit-hook)
- [Usage](#usage)
- [Changesets & Releases](#changesets--releases)
- [PRF Compatibility](#prf-compatibility)
- [Tailwind CSS](#tailwind-css)
- [Contributing](#contributing)

## Features

Our Web Wallet provides a range of features tailored to enhance the credential management experience:

- **Credential Display:** Users can easily view their stored digital credentials in a structured manner, making it simple to keep track of their qualifications.

- **Issuer Interaction:** Seamless integration with issuers allows users to request and receive new digital credentials directly within the wallet.

- **Verifier Presentation:** Users can present their credentials to verifiers using the wallet, providing a secure and efficient method of showcasing their qualifications.

- **Presentation History:** The wallet maintains a history of credential presentations, allowing users to review and track when and where they've shared their credentials.

## Prerequisites

- Node.js
- pnpm

## Installation

- Clone the repository:

- **Option 1: Using HTTPS**

  ```bash
  git clone https://github.com/your-username/wallet-frontend.git
  ```

- **Option 2: Using SSH**

  ```bash
  git clone git@github.com:your-username/wallet-frontend.git
  ```

- Navigate to the project folder:

  ```bash
  cd wallet-frontend
  ```

- Configure Environment Variables:
  The project uses environment variables to manage different configurations. A `.env` file is used to keep all these variables. There is a `.env.template` file in the repository. Copy it and rename it to `.env`.

  ```bash
  cp .env.template .env
  ```

  Now, open the .env file and fill in the variables according to your own configuration. Documentation can be found in [./docs/CONFIGURATION.md](./docs/CONFIGURATION.md)

- Install dependencies:
    ```bash
    pnpm install
    ```

- Start the development server:

    ```bash
    pnpm start
    ```

## Pre-commit Hook

We use [pre-commit](https://pre-commit.com/) to enforce our `.editorconfig` before code is committed.

### One-time setup

```
# install pre-commit if you don’t already have it
pip install pre-commit       # or brew install pre-commit / pipx install pre-commit

# enable the git hook in this repo
pre-commit install

# optional: clean up the repo on demand
pre-commit run --all-files

git add -A
```

### What happens on commit

- Auto-fixers run (e.g. add final newlines).
- After the auto-fixers, the editorconfig-checker runs inside Docker to validate all staged files.
- If violations remain, fix them manually until the commit passes.

## Usage

Once the development server is running, you can access the app by visiting http://localhost:3000 in your web browser. The app provides various pages and components that you can interact with. Explore the features and enjoy using the Wallet Frontend!

## `.gitignore` strategy

This repo uses a **allowlist (opt-in) `.gitignore`**: by default nothing at the
project root is tracked, and we explicitly re-include the files and directories
we care about.

### What this means day to day

- New top level directories will be ignored by default. Add them to the allowlist
  in `.gitignore` as required.
- Any files or sub-directories in top level directories that need to be ignored
  should be added to the ignorelist at the end of the `.gitignore` file.

## Changesets & Releases

We use [Changesets](https://github.com/changesets/changesets) to track changes and manage version bumps and the `CHANGELOG.md`.

### Adding a changeset

Whenever you make a change that should show up in the changelog (a feature, fix, or other user-facing change), add a changeset as part of your pull request:

```bash
pnpm changeset
```

This interactive prompt asks you to:

1. Pick the bump type (`major`, `minor`, or `patch`).
2. Write a short summary. This text becomes the changelog line, e.g. `fix: reroute the hyperdrive coolant`.

A new markdown file is created under `.changeset/` and commited in a new commit (automatically).

### Releasing

> [!WARNING]
> Releases are done by a maintainer.

1. **Set up the GitHub token (once).** The changelog links PR numbers and authors, which requires a token:

  ```bash
  cp .changeset/.env.example .changeset/.env
  # then edit .changeset/.env and set GITHUB_TOKEN to a token with repo read access
  ```

  This file is git-ignored and only used locally.

2. **Consume the changesets.** This deletes the pending changeset files, bumps the version in `package.json`, and updates `CHANGELOG.md`:

  ```bash
  pnpm run version
  ```

3. **Tag** the release once merged (or pushed):

  ```bash
  pnpm run tag
  git push --follow-tags
  ```

Tags follow the `v${version}` format.

#### Pre-release mode

To release beta or rc releases, you need to enter *prerelease mode*:

```bash
# to enter beta mode
pnpm run prerelease-mode enter beta

# to exit beta mode
pnpm run prerelease-mode exit
```

Instead of beta, it can be `rc`, or `alpha` or anything else.

## PRF Compatibility

The wwWallet Frontend is designed to be compatible with the PRF extension to WebAuthn, ensuring a streamlined and secure registration and authentication process. Below, we present specific compatibility scenarios based on the operating system, emphasizing both WebAuthn and PRF extension compatibility.

### Compatibility Description

The PRF (Pseudo Random Function) extension in WebAuthn enables the evaluation of a hash message authentication code stored on the security key during the retrieval of a credential. This mechanism is crucial for generating secret keys vital for encrypting user data. While WebAuthn supports various authentication methods, the focus of this table is the compatibility with the PRF extension.

### PRF Compatibility Scenarios Support by Operating System and Latest Browser Versions

<table>
  <thead>
    <tr>
      <th rowspan="2">OS</th>
      <th rowspan="2">Authenticator</th>
      <th rowspan="2">Transport</th>
      <th colspan="4">PRF Compatibility</th>
    </tr>
    <tr>
      <th style="display:flex;align-items:center;border:none;">
        <img  src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/Google_Chrome_icon_%28February_2022%29.svg/240px-Google_Chrome_icon_%28February_2022%29.svg.png" alt="Chrome" height="24"/>
        <img style="margin-left:5px;" src="https://upload.wikimedia.org/wikipedia/commons/5/51/Brave_icon_lionface.png" alt="Brave" height="24"/>
        <img style="margin-left:5px;" src="https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Microsoft_Edge_logo_%282019%29.svg/128px-Microsoft_Edge_logo_%282019%29.svg.png" alt="Microsoft Edge" height="24"/>
        <img style="margin-left:5px;" src="https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Opera_2015_icon.svg/240px-Opera_2015_icon.svg.png" alt="Opera" height="24"/>
      </th>
      <th><img src="https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Firefox_logo%2C_2019.svg/250px-Firefox_logo%2C_2019.svg.png" alt="Firefox" height="24"/></th>
      <th><img src="https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Safari_browser_logo.svg/129px-Safari_browser_logo.svg.png" alt="Safari" height="24"/></th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Linux</td>
      <td>Linux</td>
      <td>Internal</td>
      <td> </td>
      <td> </td>
      <td> </td>
    </tr>
    <tr>
      <td>Linux</td>
      <td>Android</td>
      <td>Hybrid</td>
      <td>✅</td>
      <td>❌</td>
      <td> </td>
    </tr>
    <tr>
      <td>Linux</td>
      <td>iOS</td>
      <td>Hybrid</td>
      <td>❌</td>
      <td>❌</td>
      <td> </td>
    </tr>
    <tr>
      <td>Linux</td>
      <td>FIDO Security Key</td>
      <td>USB</td>
      <td>✅</td>
      <td>✅</td>
      <td> </td>
    </tr>
    <tr>
      <td>Windows</td>
      <td>Windows</td>
      <td>Internal</td>
      <td>❌</td>
      <td>❌</td>
      <td> </td>
    </tr>
    <tr>
      <td>Windows</td>
      <td>Android</td>
      <td>Hybrid</td>
      <td>✅</td>
      <td>✅</td>
      <td> </td>
    </tr>
    <tr>
      <td>Windows</td>
      <td>iOS</td>
      <td>Hybrid</td>
      <td>✅</td>
      <td>✅</td>
      <td> </td>
    </tr>
    <tr>
      <td>Windows</td>
      <td>FIDO Security Key</td>
      <td>USB</td>
      <td>✅</td>
      <td>✅</td>
      <td> </td>
    </tr>
    <tr>
      <td>MacOS</td>
      <td>MacOS</td>
      <td>Internal</td>
      <td>✅</td>
      <td>✅</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>MacOS</td>
      <td>Android</td>
      <td>Hybrid</td>
      <td>✅</td>
      <td>❌</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>MacOS</td>
      <td>iOS</td>
      <td>Hybrid</td>
      <td>✅</td>
      <td>❌</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>MacOS</td>
      <td>FIDO Security Key</td>
      <td>USB</td>
      <td>✅</td>
      <td>❌</td>
      <td>❌</td>
    </tr>
    <tr>
      <td>Android</td>
      <td>Android</td>
      <td>Internal</td>
      <td>✅</td>
      <td>❌</td>
      <td> </td>
    </tr>
    <tr>
      <td>Android</td>
      <td>Android</td>
      <td>Hybrid</td>
      <td>✅</td>
      <td>❌</td>
      <td> </td>
    </tr>
    <tr>
      <td>Android</td>
      <td>iOS</td>
      <td>Hybrid</td>
      <td>✅</td>
      <td>❌</td>
      <td> </td>
    </tr>
    <tr>
      <td>Android</td>
      <td>FIDO Security Key</td>
      <td>USB</td>
      <td>✅<sup>[1]</sup></td>
      <td>❌</td>
      <td> </td>
    </tr>
    <tr>
      <td>Android</td>
      <td>FIDO Security Key</td>
      <td>NFC</td>
      <td>❌</td>
      <td>❌</td>
      <td> </td>
    </tr>
    <tr>
      <td>iOS</td>
      <td>iOS</td>
      <td>Internal</td>
      <td>✅</td>
      <td>✅</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>iOS</td>
      <td>Android</td>
      <td>Hybrid</td>
      <td>✅</td>
      <td>✅</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>iOS</td>
      <td>iOS</td>
      <td>Hybrid</td>
      <td>✅</td>
      <td>✅</td>
      <td>✅</td>
    </tr>
    <tr>
      <td>iOS</td>
      <td>FIDO Security Key</td>
      <td>USB</td>
      <td>❌</td>
      <td>❌</td>
      <td>❌</td>
    </tr>
    <tr>
      <td>iOS</td>
      <td>FIDO Security Key</td>
      <td>NFC</td>
      <td>❌</td>
      <td>❌</td>
      <td>❌</td>
    </tr>
  </tbody>
</table>

<sup>[1]</sup> **Note on Android with FIDO Security Keys over USB:** It's essential to have **Google Play Services (GPS) version 24.08.12 or later**.

**\*Notes:**
- Additional information about WebAuthn browser compatibility, can be found on Yubico's [WebAuthn](https://developers.yubico.com/WebAuthn/WebAuthn_Browser_Support/) and [PRF](https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/Developers_Guide_to_PRF.html) Developers page.
- ✅-marked scenarios have been confirmed using the latest public releases of relevant browsers, operating systems, and other dependencies at the time of testing.
- In this table, we use the term "FIDO Security Key" to refer to compatible security keys. It's important to understand that any security key should work with the hmac-secret extension, provided it supports this feature.
  For a detailed list of security key models that support hmac-secret, you can refer to the [FIDO MDS Explorer](https://opotonniee.github.io/fido-mds-explorer/), where hmac-secret support is listed under metadataStatement > authenticatorGetInfo > extensions.\*
- **Mozilla Firefox supports the PRF extension** starting with **version 135.0 or later** except on iOS. This is because Firefox generally uses the Gecko engine, but on iOS, all browsers are required to run on WebKit.
- iOS supports PRF extension starting with the **iOS 18** release.

The wwWallet is committed to delivering a secure and adaptable authentication experience with an emphasis on PRF extension compatibility.

## Tailwind CSS

This project utilizes **Tailwind CSS**, a utility-first CSS framework that enables rapid development of custom user interfaces with minimal effort. Tailwind CSS offers a collection of utility classes that make styling components and layouts a breeze, eliminating the need for writing extensive custom CSS.

### Styling with Utility Classes

To apply styles using Tailwind CSS, you can directly add utility classes to your HTML or JSX components. For example, to apply padding, margin, text color, and more:

```html
<div class="p-4 m-2 text-blue-500">Styled with Tailwind CSS</div>
```

### Customization

Tailwind CSS provides an extensive set of default styles, but you can also customize them to match your project's design. The **tailwind.config.js** file in the project's root directory allows you to customize colors, fonts, spacing, breakpoints, and more.

### Learn More

Explore the [Tailwind CSS documentation](https://tailwindcss.com/docs/installation) to learn about all the utility classes, configuration options, and techniques for building beautiful UIs efficiently.

## Contributing

Want to contribute? Check out our [Contribution Guidelines](https://github.com/wwWallet/.github/blob/main/CONTRIBUTING.md) for more details!
