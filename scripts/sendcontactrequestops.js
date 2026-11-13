// Contact form -> Google Apps Script web app (ContactForm.gs).
// Web app deployed 13 Nov 2026 (version 2).
const scriptURL = 'https://script.google.com/macros/s/AKfycbygfewv9rb-VP5zk29M-zMoM1-twTqOGf15XsrzQxtdmpo5HMppM8GanQTbN0r3XLoIww/exec'
const form = document.forms['submit-to-google-sheet'];
const feedbackMessage = document.getElementById("msg");

const submitButton = form.querySelector('button[type="submit"]');
const CONTACT_EMAIL = "ajoshy300@gmail.com";
let clearMsgTimer = null;

// When the form was rendered. The server rejects sends that happen too fast
// (bots) or with absurd timestamps. performance.now() gives a time-on-page
// value that is not affected by a wrong system clock.
const renderedAt = Date.now();
const renderedPerf = performance.now();

// Only these fields are sent; the server ignores anything else.
const FIELDS = ["Name", "Email", "Message", "website", "cf-turnstile-response"];

function ShowMsg(text, isError, keep){
    clearTimeout(clearMsgTimer);
    feedbackMessage.textContent = text;
    feedbackMessage.style.color = isError ? "#ff6b6b" : "";
    if (!keep) {
        clearMsgTimer = setTimeout(() => {
            feedbackMessage.textContent = "";
        }, isError ? 10000 : 6000);
    }
}

function PagePath(){
    let page = location.pathname;
    try {
        let role = (new URLSearchParams(location.search).get('role') || '').toLowerCase();
        if (!/^(ta|ue|la)$/.test(role)) role = (sessionStorage.getItem('cvRole') || '').toLowerCase();
        if (/^(ta|ue|la)$/.test(role)) page += '?role=' + role;
    } catch (e) {}
    return page;
}

const VALIDATION_TEXT = {
    name: "Please check your name (up to 100 characters, no links).",
    email: "Please check your email address.",
    crlf: "Please keep your name and email on a single line.",
    message: "Please check your message (it can be up to 5000 characters).",
    links: "Please include no more than 3 links in your message."
};

function MessageFor(result){
    const error = result && result.error;
    if (error === "validation") return VALIDATION_TEXT[result.field] || "Please check the form and try again.";
    if (error === "rate_limited") return "Thanks, but a lot of messages have come in recently. Please try again later or email me at " + CONTACT_EMAIL + ".";
    if (error === "too_fast") return "That was quick! Please wait a few seconds and press Send again.";
    if (error === "stale") return "This page has been open a long time. Please reload it and send again.";
    if (error === "captcha") return "Please complete the verification and send again.";
    return "Sorry, your message could not be sent. Please try again or email me at " + CONTACT_EMAIL + ".";
}

form.addEventListener('submit', e => {
    e.preventDefault();
    if (submitButton.disabled) return;

    const formData = new FormData(form);
    const body = new URLSearchParams();
    FIELDS.forEach(name => {
        if (formData.has(name)) body.append(name, String(formData.get(name)));
    });
    body.append("_ts", String(renderedAt));
    body.append("_te", String(Math.round(performance.now() - renderedPerf)));
    body.append("page", PagePath());

    submitButton.disabled = true;
    submitButton.setAttribute("aria-busy", "true");
    ShowMsg("Sending...", false, true);

    // URL-encoded body = a "simple" request, so no CORS preflight is needed.
    fetch(scriptURL, { method: 'POST', body: body })
        .then(response => {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.json();
        })
        .then(result => {
            if (result && result.ok === true) {
                form.reset();
                ShowMsg("Message sent. Thank you! A confirmation is on its way to your inbox.", false);
            } else {
                // Keep the user's text in the form so they can fix it and retry.
                ShowMsg(MessageFor(result), true);
            }
        })
        .catch(() => {
            ShowMsg(MessageFor(null), true);
        })
        .finally(() => {
            submitButton.disabled = false;
            submitButton.removeAttribute("aria-busy");
        });
});
