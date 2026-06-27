var allworks = document.getElementsByClassName("work");
var workShowButton = document.getElementById("showWorkBtn");
var isShowingAll = false;

function  HandleWorkImages() {

    if(!isShowingAll){
        for (let index = 0; index < allworks.length; index++) {
            allworks[index].classList.add("work-show")
            
        }
        isShowingAll = true;
    }
    else{
        EnableFirst();
    }

    workShowButton.innerText = isShowingAll ? "Show Less" : "Show More"
}

function EnableFirst(){
    for (let index = 0; index < allworks.length; index++) {

        if(index < 4){
            allworks[index].classList.add("work-show");
        }
        else allworks[index].classList.remove("work-show");
        
    }
    isShowingAll = false;
}

EnableFirst();