import journal from './meta/_journal.json';
import m0000 from './0000_peaceful_shotgun.sql';
import m0001 from './0001_many_gauntlet.sql';
import m0002 from './0002_smooth_martin_li.sql';
import m0003 from './0003_cultured_runaways.sql';
import m0004 from './0004_furry_meteorite.sql';
import m0005 from './0005_sse_update_events.sql';

export default {
	journal,
	migrations: {
		m0000,
		m0001,
		m0002,
		m0003,
		m0004,
		m0005,
	},
};
