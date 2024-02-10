  var tablinks = document.getElementsByClassName("tab-links");
        var tabcontents = document.getElementsByClassName("tab-contents")

        function  openAboutSectionTab(tabname) {
            // this function is responsible for handling the about section tabs
            
            for(item of tablinks){
                item.classList.remove("active-link");
            }
            
            for(item of tabcontents){
                item.classList.remove("active-tab");
            }
            
            event.currentTarget.classList.add("active-link");
            document.getElementById(tabname).classList.add("active-tab");
        }