
const LoadTextFile = (path, action) => {

    fetch(path)
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      return response.text();
    })
    .then(data => {
      //console.log('Loaded JSON data:', data);
      action(data);
      // Use the data as needed, e.g., update the HTML content
   //   document.getElementById('output').textContent = JSON.stringify(data, null, 2);
    })
    .catch(error => {
      console.error('Error loading JSON:', error.message);
    });

}
