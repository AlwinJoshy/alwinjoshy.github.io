const scriptURL = 'https://script.google.com/macros/s/AKfycbyG-C6fs9fDGX311-rfu1p3t64QqTqr3-vOP0bRJoWhwQlTKTOBl96FzTxgxkhEC5HPMg/exec'
const form = document.forms['submit-to-google-sheet'];
const feedbackMessage = document.getElementById("msg");


const submitButton = form.querySelector('button[type="submit"]');
let clearMsgTimer = null;

function ShowMsg(text, isError){
    clearTimeout(clearMsgTimer);
    feedbackMessage.textContent = text;
    feedbackMessage.style.color = isError ? "#ff6b6b" : "";
    clearMsgTimer = setTimeout(() => {
        feedbackMessage.textContent = "";
    }, isError ? 8000 : 5000);
}

form.addEventListener('submit', e => {
    e.preventDefault();

    const formData = new FormData(form);
    formData.append("Date", GetDate());
    formData.append("Time", GetTime());

    submitButton.disabled = true;
    submitButton.setAttribute("aria-busy", "true");
    feedbackMessage.style.color = "";
    feedbackMessage.textContent = "Sending...";

    fetch(scriptURL, { method: 'POST', body: formData })
        .then(response => {
            if (!response.ok) throw new Error("HTTP " + response.status);
            form.reset();
            ShowMsg("Message sent successfully.", false);
        })
        .catch(() => {
            // Keep the user's text in the form so they can retry.
            ShowMsg("Sorry, your message could not be sent. Please try again or email me directly.", true);
        })
        .finally(() => {
            submitButton.disabled = false;
            submitButton.removeAttribute("aria-busy");
        });
});

function GetDate(){
    const today = new Date();
    const yyyy = today.getFullYear();
    let mm = today.getMonth() + 1; // Months start at 0!
    let dd = today.getDate();

    if (dd < 10) dd = '0' + dd;
    if (mm < 10) mm = '0' + mm;

    const formattedToday = dd + '/' + mm + '/' + yyyy;
    return formattedToday;
}

function GetTime(){
    return new Date().getTime();
}