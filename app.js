const http = require("node:http");

// Fictional records for our demo.
const members = new Map([
  ["M1001", { name: "Alex Example", balance: "1,245.67" }],
  ["M1002", { name: "Taylor Sample", balance: "420.00" }]
]);

// Shared appearance for every page.
function layout(content) {
  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Demo Banking App</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            background: #eef2f7;
            color: #18243b;
            max-width: 700px;
            margin: 60px auto;
            padding: 20px;
          }
          main {
            background: white;
            padding: 32px;
            border-radius: 12px;
          }
          input, button {
            padding: 12px;
            font-size: 16px;
            margin-top: 12px;
          }
          button {
            background: #2457d6;
            color: white;
            border: none;
            cursor: pointer;
          }
          a { color: #2457d6; }
          .notice { color: #666; font-size: 14px; }
          [role="alert"] { color: #b42318; }
        </style>
      </head>
      <body>
        <main>
          <h1>Member Servicing</h1>
          <p class="notice">Demo only — fictional member records.</p>
          ${content}
        </main>
      </body>
    </html>
  `;
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:3300");
  const memberId = url.searchParams.get("member") || "";
  const member = members.get(memberId);

  let content;
  let status = 200;

  if (url.pathname === "/") {
    content = `
      <h2>Find a member</h2>
      <form action="/search" method="GET">
        <label for="member">Member ID</label><br>
        <input id="member" name="member" required>
        <button type="submit">Search</button>
      </form>
      <p>Try M1001 or M1002.</p>
    `;
  } else if (
    ["/search", "/member", "/savings"].includes(url.pathname)
  ) {
    if (!/^M\d{4}$/.test(memberId)) {
      content = `
        <p role="alert">Invalid member ID</p>
        <p>Enter M followed by four digits.</p>
        <a href="/">Search again</a>
      `;
    } else if (!member) {
      content = `
        <p role="status">Member not found</p>
        <a href="/">Search again</a>
      `;
    } else if (url.pathname === "/search") {
      content = `
        <h2>Search results</h2>
        <p>${member.name}</p>
        <a href="/member?member=${memberId}">
          Open member ${memberId}
        </a>
      `;
    } else if (url.pathname === "/member") {
      content = `
        <h2>Member details</h2>
        <p>Member ID: ${memberId}</p>
        <p>Name: ${member.name}</p>
        <a href="/savings?member=${memberId}">
          View savings account
        </a>
      `;
    } else {
      content = `
        <h2>Savings account</h2>
        <p>Member ID: ${memberId}</p>
        <p>Current balance:
          <span aria-label="Current balance">$${member.balance}</span>
        </p>
        <a href="/">New search</a>
      `;
    }
  } else {
    status = 404;
    content = `<h2>Page not found</h2><a href="/">Home</a>`;
  }

  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8"
  });
  response.end(layout(content));
});

server.listen(3300, "127.0.0.1", () => {
  console.log("App running at http://127.0.0.1:3300");
});