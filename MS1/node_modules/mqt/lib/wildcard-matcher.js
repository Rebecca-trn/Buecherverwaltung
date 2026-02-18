
// returns a function that will match the given wildcard
const wildcard = (src) => {
  const parts = src.split('/')

  return (target) => {

    for (var i = 0; i < parts.length; i++) {
      if(parts[i] == '#')
        return true

      if(parts[i] == '+')
        continue

      if(parts[i] != target[i])
        return false
    }

    return parts.length == target.length
  }
}

export default wildcard
