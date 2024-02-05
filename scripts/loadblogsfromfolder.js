var yearBlogContent = null;
var blogDisplay = null;
var totalBlogsCount = 0;
var fetchCompleatedCount = 0;
var allContentTextArray = [];


function DisplayElements() {

    console.log("Display Elements");
    const blogContainer = document.getElementById('all-blogs-list');
    let dict = {}

    for (let index = 0; index < allContentTextArray.length; index++) {

        if (dict[allContentTextArray[index].year] == undefined || dict[allContentTextArray[index].year] == null) {
            dict[allContentTextArray[index].year] = GetBlock(allContentTextArray[index]);
        }
        else {
            dict[allContentTextArray[index].year] += GetBlock(allContentTextArray[index]);
        }

    }

    const keys = Object.keys(dict);
    let genHTML = "";
    for (let index = 0; index < keys.length; index++) {

        console.log("Content : " + dict[keys[index]]);
        var newYearBlock = yearBlogContent;
        newYearBlock = newYearBlock.replace("{{placeholder_blog_year}}", keys[index]);
        genHTML += newYearBlock.replace("{{placeholder_blog_list_elements}}", dict[keys[index]]);
    }
    console.log("Content : " + genHTML);
    blogContainer.innerHTML += genHTML;
    console.log(genHTML);
}

function GetBlock(dataObject) {

    var blogString = blogDisplay;

    var htmlString = dataObject.pageContent;

    var src = ExtractImageUrl(htmlString, '<div class="blog-prime-image">', '.blog-prime-image img');


    blogString = blogString.replace("{{placeholder_img_url}}", src);
    blogString = blogString.replace("{{placeholder_h1_title}}", ExtractH1Text(htmlString, '<h1 class="blog-title">', '</h1>'));
    blogString = blogString.replace("{{placeholder_content_glimps}}", GetFirstLines(htmlString, '<p>', 200));
    blogString = blogString.replace("{{placeholder_page_url}}", '"' + dataObject.pageUrl + '"');

    return blogString;

}

function ExtractH1Text(htmlString, startText, endText) {
    const startIndex = htmlString.indexOf(startText);
    const endIndex = htmlString.indexOf(endText, startIndex);

    // Extract the content inside the <h1> element
    const h1Content = htmlString.substring(startIndex + startText.length, endIndex);
    return h1Content;
}

function GetFirstLines(htmlString, startText, readLength) {
    const startIndex = htmlString.indexOf(startText);
    const endIndex = startIndex + readLength;

    // Extract the content inside the <h1> element
    let h1Content = htmlString.substring(startIndex + startText.length, endIndex);
    h1Content = h1Content.trimStart();
    return h1Content;
}

function ExtractImageUrl(htmlString, startTag, id) {
    const startIndex = htmlString.indexOf(startTag);
    const endIndex = htmlString.indexOf('</div>', startIndex) + '</div>'.length;

    // Extract the relevant part of the HTML string
    const relevantHtml = htmlString.substring(startIndex, endIndex);

    // Create a temporary div element to parse the extracted HTML string
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = relevantHtml;
    // Get the image element with the class "blog-prime-image" from the parsed HTML
    const blogPrimeImage = tempDiv.querySelector(id);

    var srcUrl = "NA";

    // Check if the image element exists
    if (blogPrimeImage) {
        // Get the src attribute of the image
        srcUrl = blogPrimeImage.src;
        // blogString = blogString.replace("{{placeholder_img_url}}", srcUrl);
        console.log('Source URL of the blog prime image:', srcUrl);
    } else {
        console.log('Blog prime image not found.');
    }
    return srcUrl;
}

function CallWhenHTMLTextLoaded(index) {
    fetchCompleatedCount++;
    if (totalBlogsCount == fetchCompleatedCount) {
        DisplayElements();
    }
}

function LoadAllBlogData(allblogs) {

    for (let index = 0; index < allblogs.data.length; index++) {

        for (let j = 0; j < allblogs.data[index].pages.length; j++) {

            let newObejct = {
                year: allblogs.data[index].year,
                pageContent: "",
                pageUrl: "vlue"
            };
            let i = totalBlogsCount;
            newObejct.pageUrl = allblogs.data[index].pages[j];

            LoadTextFile(allblogs.data[index].pages[j], (text) => {
                allContentTextArray[i].pageContent = text;
                CallWhenHTMLTextLoaded(i);
            });

            allContentTextArray.push(newObejct);

            totalBlogsCount++;
        }
    }

    //   console.log(allContentTextArray.toString())
}

function AutoLoadBlogs() {

    const blogYearTextFilePath = "/components/blogYearSection.html";
    const blogBlockTextFilePath = "/components/blogContentDisplay.html";
    const blogContentMapFilePath = '/json/blogList.json';

    LoadTextFile(blogYearTextFilePath,
        (data) => {
            yearBlogContent = data;
            LoadTextFile(blogBlockTextFilePath,
                (data) => {
                    blogDisplay = data;
                    LoadJsonFile(blogContentMapFilePath, LoadAllBlogData);
                }
            )
        }
    );
}


AutoLoadBlogs();

