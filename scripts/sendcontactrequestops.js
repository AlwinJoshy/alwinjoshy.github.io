const scriptURL = 'https://script.google.com/macros/s/AKfycbyG-C6fs9fDGX311-rfu1p3t64QqTqr3-vOP0bRJoWhwQlTKTOBl96FzTxgxkhEC5HPMg/exec'
const form = document.forms['submit-to-google-sheet'];
const feedbackMessage = document.getElementById("msg");


form.addEventListener('submit', e => {

    var formData = new FormData(form);
    formData.append("Date", GetDate());
    formData.append("Time", GetTime());
    e.preventDefault()
    fetch(scriptURL, { method: 'POST', body: formData})
    .then(
        response => {
            console.log('Success!', response);
            feedbackMessage.innerHTML = "Message sent succesfully.";
            ClearMsg();
    }
    )
    .catch(error => console.error('Error!', error.message))
})

function ClearMsg(){
    form.reset();
    setTimeout(() =>{
        feedbackMessage.innerHTML = "";
    }, 5000);
}

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