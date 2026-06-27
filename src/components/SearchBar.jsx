import React from 'react';

const SearchBar = ({ lang, translations, onSearch }) => {
  const t = translations[lang];
  const [value, setValue] = React.useState('');

  const handleChange = (e) => {
    setValue(e.target.value);
    onSearch(e.target.value);
  };

  const handleClear = () => {
    setValue('');
    onSearch('');
  };

  return (
    <div className="search-container fade-in-up">
      <i className="fas fa-search search-icon"></i>
      <input 
        type="text" 
        className="search-input" 
        placeholder={t.search_placeholder}
        value={value}
        onChange={handleChange}
      />
      {value && (
        <i 
          className="fas fa-times clear-search" 
          onClick={handleClear}
          style={{ display: 'block' }}
        ></i>
      )}
    </div>
  );
};

export default SearchBar;
